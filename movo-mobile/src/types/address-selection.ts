/**
 * Selección de una dirección resuelta (búsqueda Places, GPS, pin en mapa o guardada).
 * Extraído de `shipment-wizard-store.ts` (MOVO-83) a un módulo neutral en MOVO-121
 * para que `address-search-sheet.tsx` sea reusable fuera del wizard de envío (pantalla
 * de gestión de direcciones guardadas) sin importar el store de Zustand del wizard.
 */
export type AddressSource = "places" | "gps" | "map-pin" | "saved";

export interface AddressSelection {
  address: string;
  lat: number;
  lng: number;
  source: AddressSource;
  /**
   * `true` mientras se busca la dirección de un pin recién movido: `address` todavía es provisoria y la selección no
   * se puede guardar ni usar para avanzar (`isAddressSelectionReady`).
   */
  resolving?: boolean;
}

/** Selección completa y definitiva: con texto, coordenadas válidas y sin una búsqueda de dirección pendiente. */
export function isAddressSelectionReady(selection: AddressSelection | null | undefined): selection is AddressSelection {
  if (!selection || selection.resolving) return false;
  return (
    selection.address.trim().length > 0 &&
    Number.isFinite(selection.lat) &&
    selection.lat >= -90 &&
    selection.lat <= 90 &&
    Number.isFinite(selection.lng) &&
    selection.lng >= -180 &&
    selection.lng <= 180
  );
}
