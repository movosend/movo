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
}
