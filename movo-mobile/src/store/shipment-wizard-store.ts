import { create } from "zustand";
import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import type { AddressSelection } from "../types/address-selection";

/**
 * Store del wizard de creación de envío (MOVO-83). Fuente de verdad única para los 5
 * pasos (paquete → receptor → direcciones+franja horaria → fotos → resumen),
 * desacoplada del ciclo de vida del componente de ruta (`app/(app)/send.tsx`) —
 * necesario porque bajo expo-router salir a otra tab y volver desmontaría cualquier
 * `useState` local, perdiendo todo el progreso cargado (AC11).
 *
 * Deliberadamente in-memory, sin persistir a secure-store: AC11 solo pide sobrevivir
 * a la navegación hacia atrás dentro de la sesión, no a que la app se mate — y las
 * fotos acá viven como URIs locales + estado de upload parcial, que no vale la pena
 * (ni es seguro) persistir entre sesiones de la app.
 *
 * `resetWizard()` se llama SOLO desde dos lugares por diseño: tras un submit
 * exitoso (antes de navegar) y al abandonar explícitamente desde el paso 0 (diálogo
 * de confirmación). Nunca implícito en un unmount — es justo el bug que el ticket
 * advierte evitar: no arrastrar datos de un envío anterior al siguiente.
 */

export type PackageType = "letter_document" | "standard_package" | "fragile_item";

export type WizardPhotoStatus = "idle" | "compressing" | "ready" | "uploading" | "uploaded" | "error";

export interface WizardPhoto {
  id: string;
  localUri: string;
  status: WizardPhotoStatus;
  progress: number;
  s3Key: string | null;
  errorMessage: string | null;
}

/**
 * Cotización del paso de resumen (MOVO-255). `quoteId` congela `suggestedPriceArs` en
 * el backend hasta `expiresAt`: se manda al crear el envío para que se cree
 * exactamente a ese precio. Los setters de los datos que afectan el precio (tipo,
 * peso, dimensiones, direcciones) la descartan, así nunca viaja un `quoteId` de datos
 * viejos.
 */
export interface PriceQuoteState {
  suggestedPriceArs: number | null;
  highDemand: boolean | null;
  quoteId: string | null;
  expiresAt: string | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  /** `true` si se volvió a cotizar tras un 409 al crear: el emisor tiene que ver el
   * precio nuevo ("El precio se actualizó") y confirmar de nuevo. */
  updated: boolean;
}

export const IDLE_PRICE_QUOTE: PriceQuoteState = {
  suggestedPriceArs: null,
  highDemand: null,
  quoteId: null,
  expiresAt: null,
  status: "idle",
  updated: false,
};

export interface SubmissionState {
  status: "idle" | "submitting" | "error";
  errorMessage: string | null;
  /** Paso al que hay que volver si el backend devolvió un error de negocio mapeable
   * a un paso concreto (p.ej. `SHIPMENT_RECEIVER_KYC_NOT_APPROVED` → paso 1). `null`
   * si el error no es atribuible a un paso puntual. */
  fieldErrorStep: number | null;
  /** Id del envío ya creado, para que un reintento (p.ej. tras un fallo de subida de
   * fotos que manda al usuario de vuelta al paso 4) no dispare `createShipment` de
   * nuevo — vive acá y no en un `useState` de `SummaryStep` porque volver al paso 4
   * desmonta el componente. */
  shipmentId: string | null;
}

interface ShipmentWizardState {
  step: number;
  packageType: PackageType | null;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  description: string;
  receiver: PublicProfile | null;
  pickup: AddressSelection | null;
  delivery: AddressSelection | null;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  photos: WizardPhoto[];
  priceQuote: PriceQuoteState;
  submission: SubmissionState;

  setStep: (step: number) => void;
  setPackageType: (packageType: PackageType | null) => void;
  setWeightKg: (weightKg: string) => void;
  setLengthCm: (lengthCm: string) => void;
  setWidthCm: (widthCm: string) => void;
  setHeightCm: (heightCm: string) => void;
  setDescription: (description: string) => void;
  setReceiver: (receiver: PublicProfile | null) => void;
  setPickup: (selection: AddressSelection | null) => void;
  setDelivery: (selection: AddressSelection | null) => void;
  setPickupDate: (pickupDate: string) => void;
  setPickupTimeWindowStart: (value: string) => void;
  setPickupTimeWindowEnd: (value: string) => void;
  addPhoto: (photo: WizardPhoto) => void;
  updatePhoto: (id: string, patch: Partial<WizardPhoto>) => void;
  removePhoto: (id: string) => void;
  setPriceQuote: (quote: PriceQuoteState) => void;
  setSubmission: (patch: Partial<SubmissionState>) => void;
  resetWizard: () => void;
}

const initialState = {
  step: 0,
  packageType: null,
  weightKg: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  description: "",
  receiver: null,
  pickup: null,
  delivery: null,
  pickupDate: "",
  pickupTimeWindowStart: "",
  pickupTimeWindowEnd: "",
  photos: [] as WizardPhoto[],
  priceQuote: IDLE_PRICE_QUOTE,
  submission: { status: "idle", errorMessage: null, fieldErrorStep: null, shipmentId: null } as SubmissionState,
};

const sameCoords = (a: AddressSelection | null, b: AddressSelection | null) =>
  a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);

export const useShipmentWizardStore = create<ShipmentWizardState>((set) => ({
  ...initialState,

  setStep: (step) => set({ step }),
  // MOVO-255: un cambio real en un dato que afecta el precio descarta la cotización.
  setPackageType: (packageType) =>
    set((state) => (state.packageType === packageType ? {} : { packageType, priceQuote: IDLE_PRICE_QUOTE })),
  setWeightKg: (weightKg) =>
    set((state) => (state.weightKg === weightKg ? {} : { weightKg, priceQuote: IDLE_PRICE_QUOTE })),
  setLengthCm: (lengthCm) =>
    set((state) => (state.lengthCm === lengthCm ? {} : { lengthCm, priceQuote: IDLE_PRICE_QUOTE })),
  setWidthCm: (widthCm) =>
    set((state) => (state.widthCm === widthCm ? {} : { widthCm, priceQuote: IDLE_PRICE_QUOTE })),
  setHeightCm: (heightCm) =>
    set((state) => (state.heightCm === heightCm ? {} : { heightCm, priceQuote: IDLE_PRICE_QUOTE })),
  setDescription: (description) => set({ description }),
  setReceiver: (receiver) => set({ receiver }),
  setPickup: (pickup) =>
    set((state) => (sameCoords(state.pickup, pickup) ? { pickup } : { pickup, priceQuote: IDLE_PRICE_QUOTE })),
  setDelivery: (delivery) =>
    set((state) =>
      sameCoords(state.delivery, delivery) ? { delivery } : { delivery, priceQuote: IDLE_PRICE_QUOTE },
    ),
  setPickupDate: (pickupDate) => set({ pickupDate }),
  setPickupTimeWindowStart: (pickupTimeWindowStart) => set({ pickupTimeWindowStart }),
  setPickupTimeWindowEnd: (pickupTimeWindowEnd) => set({ pickupTimeWindowEnd }),

  addPhoto: (photo) => set((state) => ({ photos: [...state.photos, photo] })),
  updatePhoto: (id, patch) =>
    set((state) => ({
      photos: state.photos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    })),
  removePhoto: (id) => set((state) => ({ photos: state.photos.filter((photo) => photo.id !== id) })),

  setPriceQuote: (priceQuote) => set({ priceQuote }),
  setSubmission: (patch) => set((state) => ({ submission: { ...state.submission, ...patch } })),

  resetWizard: () => set({ ...initialState, photos: [] }),
}));
