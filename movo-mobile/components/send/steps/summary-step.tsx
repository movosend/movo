import { router } from "expo-router";
import { ClipboardCheck } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { createPhotoUploadProvider } from "../../../src/adapters/photo-upload-provider";
import { createPricingProvider, type PricingQuoteInput } from "../../../src/adapters/pricing-provider";
import { useCreateShipment } from "../../../src/hooks/use-shipments";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { uriToBlob } from "../../../src/lib/photo-utils";
import { capitalizeName } from "../../../src/lib/profile-format";
import { formatPickupDateLabel, formatPickupWindowLabel } from "../../../src/lib/shipment-format";
import {
  IDLE_PRICE_QUOTE,
  useShipmentWizardStore,
  type WizardPhoto,
} from "../../../src/store/shipment-wizard-store";
import type { CreateShipmentInput } from "../../../src/api/shipments-client";
import { ErrorBanner } from "../../ui/error-banner";
import { packageTypeLabel } from "../category-grid";
import { PricePreviewCard } from "../price-preview-card";
import { PublishShipmentButton } from "../publish-shipment-button";
import { ReviewRow } from "../review-row";
import { RouteMapCard } from "../route-map-card";

/** Mapea un `ApiErrorCode` de negocio del submit a un paso del wizard al que volver
 * (AC12 + el error-handling del plan) — `null` si no es atribuible a un paso puntual. */
function errorCodeToStep(code: string): number | null {
  switch (code) {
    case "SHIPMENT_RECEIVER_IS_SENDER":
    case "SHIPMENT_RECEIVER_KYC_NOT_APPROVED":
    case "USER_NOT_FOUND":
      return 1;
    case "SHIPMENT_PICKUP_WINDOW_INVALID":
    case "SHIPMENT_PICKUP_WINDOW_IN_PAST":
    case "SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE":
      return 2;
    default:
      return null;
  }
}

/** MOVO-255: la cotización congelada venció o ya no coincide con los datos. */
const QUOTE_ERROR_CODES = new Set(["QUOTE_EXPIRED", "QUOTE_MISMATCH"]);

type WizardSnapshot = ReturnType<typeof useShipmentWizardStore.getState>;

/** Datos que afectan el precio, o `null` si falta alguno. */
function buildPriceInput(state: WizardSnapshot): PricingQuoteInput | null {
  const weightKg = Number(state.weightKg) || null;
  const lengthCm = Number(state.lengthCm) || null;
  const widthCm = Number(state.widthCm) || null;
  const heightCm = Number(state.heightCm) || null;
  if (!state.packageType || !state.pickup || !state.delivery || !weightKg || !lengthCm || !widthCm || !heightCm) {
    return null;
  }
  return {
    packageType: state.packageType,
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
    pickup: { lat: state.pickup.lat, lng: state.pickup.lng },
    delivery: { lat: state.delivery.lat, lng: state.delivery.lng },
  };
}

function isQuoteStillValid(quote: WizardSnapshot["priceQuote"]): boolean {
  return (
    quote.status === "ready" &&
    quote.quoteId !== null &&
    quote.expiresAt !== null &&
    new Date(quote.expiresAt).getTime() > Date.now()
  );
}

/**
 * Cotiza contra el backend y guarda el resultado en el store (MOVO-255). Si mientras
 * tanto cambió algún dato que afecta el precio, descarta la respuesta: sería el precio
 * de un envío que ya no es el que está en el wizard.
 */
async function refreshQuote(updated: boolean): Promise<void> {
  const { setPriceQuote } = useShipmentWizardStore.getState();
  const input = buildPriceInput(useShipmentWizardStore.getState());
  if (!input) {
    setPriceQuote({ ...IDLE_PRICE_QUOTE, status: "unavailable" });
    return;
  }

  setPriceQuote({ ...useShipmentWizardStore.getState().priceQuote, quoteId: null, status: "loading", updated });
  let next: WizardSnapshot["priceQuote"];
  try {
    const result = await createPricingProvider().getQuote(input);
    next =
      result.quoteId === null
        ? { ...IDLE_PRICE_QUOTE, status: "unavailable", updated }
        : {
            suggestedPriceArs: result.suggestedPriceArs,
            highDemand: result.highDemand,
            quoteId: result.quoteId,
            expiresAt: result.expiresAt,
            status: "ready",
            updated,
          };
  } catch {
    next = { ...IDLE_PRICE_QUOTE, status: "unavailable", updated };
  }

  const current = buildPriceInput(useShipmentWizardStore.getState());
  if (JSON.stringify(current) === JSON.stringify(input)) {
    setPriceQuote(next);
  }
}

interface SummaryStepProps {
  onGoToStep: (step: number) => void;
}

export function SummaryStep({ onGoToStep }: SummaryStepProps) {
  const state = useShipmentWizardStore();
  const {
    packageType,
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
    receiver,
    pickup,
    delivery,
    pickupDate,
    pickupTimeWindowStart,
    pickupTimeWindowEnd,
    photos,
    priceQuote,
    submission,
    setSubmission,
    updatePhoto,
    resetWizard,
  } = state;

  const createShipment = useCreateShipment();

  // MOVO-255: se cotiza solo al entrar al resumen (cambiar un dato que afecta el
  // precio implica volver a otro paso, que desmonta este). Si la cotización guardada
  // sigue vigente se reusa: volver del paso de fotos no tiene por qué cambiar el precio.
  useEffect(() => {
    const current = useShipmentWizardStore.getState().priceQuote;
    if (current.status !== "loading" && !isQuoteStillValid(current)) {
      void refreshQuote(false);
    }
  }, []);

  async function uploadPhotos(shipmentId: string, photosToUpload: WizardPhoto[]) {
    const provider = createPhotoUploadProvider();
    for (const photo of photosToUpload) {
      updatePhoto(photo.id, { status: "uploading", progress: 0, errorMessage: null });
      try {
        // El blob se resuelve antes del presign: `contentLength` viaja firmado dentro
        // de la presigned URL (AC3 de MOVO-81) y tiene que coincidir exacto con el
        // tamaño real del blob que se sube después, o S3 rechaza la firma.
        const blob = await uriToBlob(photo.localUri);
        const { uploadUrl, s3Key } = await provider.requestUploadUrl(shipmentId, "creation", "image/jpeg", blob.size);
        await provider.uploadToUrl(uploadUrl, blob, "image/jpeg", (pct) => updatePhoto(photo.id, { progress: pct }));
        await provider.confirmUpload(shipmentId, s3Key, "creation");
        updatePhoto(photo.id, { status: "uploaded", s3Key, progress: 100 });
      } catch {
        updatePhoto(photo.id, { status: "error", errorMessage: "No se pudo subir esta foto. Reintentá." });
      }
    }
  }

  /** Hace el trabajo real detrás de `PublishShipmentButton` (MOVO-83): crea el envío
   * si todavía no existe (reintentos después de un error no lo duplican, gracias a
   * `submission.shipmentId` — vive en el store, no en un `useState` local, porque un
   * reintento desde el paso de fotos desmonta este componente) y sube las fotos
   * pendientes. Devuelve el id para que el botón navegue a `/shipments/:id` en su
   * pantalla de éxito — a diferencia del submit anterior, ya no navega ni resetea el
   * wizard acá adentro, eso pasa recién cuando el usuario toca "Ver envío"
   * (`handleViewShipment`). */
  async function publish(): Promise<string> {
    if (!receiver || !pickup || !delivery) {
      const err = new Error("Faltan datos del envío.");
      setSubmission({ status: "error", errorMessage: err.message, fieldErrorStep: null });
      throw err;
    }
    setSubmission({ status: "submitting", errorMessage: null, fieldErrorStep: null });

    let shipmentId = submission.shipmentId;
    if (!shipmentId) {
      const body: CreateShipmentInput = {
        packageType: packageType!,
        weightKg: Number(weightKg),
        lengthCm: Number(lengthCm),
        widthCm: Number(widthCm),
        heightCm: Number(heightCm),
        description: state.description || undefined,
        receiverId: receiver.id,
        pickupAddress: pickup.address,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        deliveryAddress: delivery.address,
        deliveryLat: delivery.lat,
        deliveryLng: delivery.lng,
        pickupDate,
        pickupTimeWindowStart,
        pickupTimeWindowEnd,
      };
      // MOVO-255: con `quoteId` el envío se crea exactamente al precio mostrado. Sin
      // él (pricing no respondió, "precio a estimar") el backend cotiza al crear.
      const { quoteId } = useShipmentWizardStore.getState().priceQuote;
      if (quoteId) {
        body.quoteId = quoteId;
      }

      try {
        const created = await createShipment.mutateAsync(body);
        shipmentId = created.id;
        setSubmission({ shipmentId: created.id });
      } catch (err) {
        // MOVO-255 (AC4): la cotización venció o no coincide. Nunca se reintenta la
        // creación sola: se vuelve a cotizar, se muestra el precio nuevo y el emisor
        // tiene que volver a tocar "Publicar".
        if (err instanceof ApiError && QUOTE_ERROR_CODES.has(err.code)) {
          setSubmission({ status: "idle", errorMessage: null, fieldErrorStep: null });
          await refreshQuote(true);
          throw err;
        }
        const fieldErrorStep = err instanceof ApiError ? errorCodeToStep(err.code) : null;
        setSubmission({
          status: "error",
          errorMessage: friendlyErrorMessage(err, "No pudimos crear el envío. Intentá de nuevo."),
          fieldErrorStep,
        });
        throw err;
      }
    }

    const pending = photos.filter((p) => p.status !== "uploaded");
    if (pending.length > 0) {
      await uploadPhotos(shipmentId, pending);
    }

    const stillFailing = useShipmentWizardStore.getState().photos.some((p) => p.status === "error");
    if (stillFailing) {
      const err = new Error("photo-upload-failed");
      setSubmission({
        status: "error",
        errorMessage: "El envío se creó, pero alguna foto no se pudo subir. Volvé al paso de fotos y reintentá.",
        // Reusa el mismo link "Ir a corregir" que ya existe para errores de negocio del
        // backend (ver `errorCodeToStep`) — el paso de fotos (índice 3) es donde el
        // usuario puede ver cuál falló y tocar reintentar.
        fieldErrorStep: 3,
      });
      throw err;
    }

    setSubmission({ status: "idle", errorMessage: null, fieldErrorStep: null });
    return shipmentId;
  }

  function handleViewShipment(shipmentId: string) {
    resetWizard();
    router.replace(`/(app)/shipments/${shipmentId}`);
  }

  return (
    <View className="gap-6">
      <View className="mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <ClipboardCheck size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">Revisá y confirmá</Text>
        <Text className="font-sans text-body text-fg-2">Chequeá los datos antes de publicar el envío.</Text>
      </View>

      <RouteMapCard testID="summary-step-route-map" pickup={pickup} delivery={delivery} onEdit={() => onGoToStep(2)} />

      {submission.status === "error" ? (
        <View>
          <ErrorBanner testID="summary-step-error" message={submission.errorMessage} />
          {submission.fieldErrorStep !== null ? (
            <Pressable
              testID="summary-step-go-to-error"
              onPress={() => submission.fieldErrorStep !== null && onGoToStep(submission.fieldErrorStep)}
              className="mt-2 self-start rounded-full border border-border-strong px-3.5 py-1.5"
            >
              <Text className="font-sans-medium text-[12px] text-fg">Ir a corregir</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View className="overflow-hidden rounded-[10px] border border-border">
        <ReviewRow label="Tipo de paquete" value={packageTypeLabel(packageType)} onEdit={() => onGoToStep(0)} />
        {packageType === "letter_document" ? null : (
          <>
            <ReviewRow label="Peso" value={`${weightKg || "—"} kg`} onEdit={() => onGoToStep(0)} />
            <ReviewRow
              label="Dimensiones"
              value={`${lengthCm || "—"} × ${widthCm || "—"} × ${heightCm || "—"} cm`}
              onEdit={() => onGoToStep(0)}
            />
          </>
        )}
        <ReviewRow
          label="Receptor"
          value={receiver ? capitalizeName(receiver.fullName) : "—"}
          badge={receiver?.isVerified ? "Verificado" : undefined}
          onEdit={() => onGoToStep(1)}
        />
        <ReviewRow
          label="Franja horaria"
          value={`${formatPickupDateLabel(pickupDate) || "—"} · ${formatPickupWindowLabel(pickupTimeWindowStart, pickupTimeWindowEnd) || "—"}`}
          onEdit={() => onGoToStep(2)}
          last
        />
      </View>

      {priceQuote.updated && priceQuote.status === "ready" ? (
        <View
          testID="summary-step-price-updated"
          className="rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3"
        >
          <Text className="font-sans-semibold text-[13px] text-ink-950">El precio se actualizó</Text>
          <Text className="mt-0.5 font-sans text-[13px] text-ink-950/70">
            Revisá el nuevo costo y volvé a confirmar para publicar el envío.
          </Text>
        </View>
      ) : null}

      <PricePreviewCard
        testID="summary-step-price"
        suggestedPriceArs={priceQuote.status === "ready" ? priceQuote.suggestedPriceArs : null}
        caption={
          priceQuote.status === "loading"
            ? "Calculando…"
            : packageType === "letter_document"
              ? packageTypeLabel(packageType)
              : `${weightKg || "—"} kg · ${packageTypeLabel(packageType)}`
        }
      />

      <PublishShipmentButton
        testID="summary-step-submit"
        disabled={!receiver || !pickup || !delivery || priceQuote.status === "loading"}
        onPublish={publish}
        onPublishError={() => {}}
        onViewShipment={handleViewShipment}
      />
    </View>
  );
}
