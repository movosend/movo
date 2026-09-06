import { useCallback, useEffect, useState } from "react";
import { useAddresses } from "./use-addresses";
import { useMyLocation } from "./use-my-location";
import type { AddressSelection, AddressSource } from "../types/address-selection";

export interface TransportOrigin {
  lat: number;
  lng: number;
  address: string;
  source: AddressSource;
  /** Ciudad estructurada, solo disponible cuando `source === "saved"` (viene del
   * campo `Address.city`, no de texto libre). Para GPS/manual no hay un campo
   * equivalente — `address` ahí es un `formattedAddress` de Google que sí tiene forma
   * de dirección completa y de donde vale la pena derivar una zona con
   * `zoneLabelFromAddress()`. `Address.label` en cambio es texto libre del usuario (a
   * veces literalmente la calle, "Casa", etc.) — nunca corresponde parsearlo como si
   * fuera una dirección formateada. */
  city?: string;
}

/**
 * Resuelve el punto de partida del tab "Transportar" (MOVO-148, AC2) con la cascada
 * pedida por el ticket: GPS → dirección default de la libreta → selector manual (el
 * mismo `AddressSearchSheet` que ya usa el wizard de envío). Un origen elegido a mano
 * (`setManualSelection`) siempre gana sobre GPS/default una vez elegido — así el
 * mismo mecanismo sirve tanto para el fallback final como para "Cambiar ubicación"
 * en el header, sin duplicar estado.
 *
 * No relanza el intento de GPS solo porque `useAddresses()` tarde más o menos: el
 * intento de geolocalización corre una única vez al montar (`resolveCurrentLocation`
 * nunca lanza, ver `use-my-location.ts`), y mientras tanto se espera a que la query
 * de direcciones asiente antes de decidir si hace falta el selector manual.
 *
 * `enabled` (MOVO-163): el feed filtrado por viaje no depende de la ubicación del
 * usuario (el filtro es por el corredor del viaje, no por cercanía) — con
 * `enabled: false` no se dispara el pedido de permiso de GPS ni la cascada, y
 * `origin`/`resolving`/`needsManualPick` quedan en su estado neutro.
 */
export function useTransportOrigin(enabled = true) {
  const { resolveCurrentLocation } = useMyLocation();
  const addressesQuery = useAddresses();
  const [gpsAttempted, setGpsAttempted] = useState(false);
  const [gpsResult, setGpsResult] = useState<AddressSelection | null>(null);
  const [manualOrigin, setManualOrigin] = useState<TransportOrigin | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    resolveCurrentLocation().then((result) => {
      if (cancelled) return;
      setGpsResult(result);
      setGpsAttempted(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // `retry:false` en `useAddresses()` (MOVO-119) — un error ahí ya significa "sin
  // direcciones guardadas, no reintentar", así que cuenta como asentada igual que un
  // `isSuccess` con lista vacía.
  const addressesSettled = !addressesQuery.isLoading;
  const defaultAddress = addressesQuery.data?.find((a) => a.isDefault) ?? null;

  const gpsOrigin: TransportOrigin | null = gpsResult
    ? { lat: gpsResult.lat, lng: gpsResult.lng, address: gpsResult.address, source: "gps" }
    : null;
  const savedOrigin: TransportOrigin | null = defaultAddress
    ? {
        lat: defaultAddress.lat,
        lng: defaultAddress.long,
        address: defaultAddress.label ?? `${defaultAddress.street} ${defaultAddress.streetNumber}, ${defaultAddress.city}`,
        source: "saved",
        city: defaultAddress.city,
      }
    : null;

  const origin = enabled ? manualOrigin ?? gpsOrigin ?? (gpsAttempted ? savedOrigin : null) : null;

  const resolving = enabled && (!gpsAttempted || (gpsOrigin === null && !addressesSettled));
  const needsManualPick = enabled && !resolving && origin === null;

  const setManualSelection = useCallback((selection: AddressSelection) => {
    setManualOrigin({ lat: selection.lat, lng: selection.lng, address: selection.address, source: selection.source });
  }, []);

  return { origin, resolving, needsManualPick, setManualSelection };
}
