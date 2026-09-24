import { useCallback, useEffect, useRef, useState } from "react";
import {
  GenerateHandshakeResult,
  ShipmentSummary,
  shipmentsClient,
} from "../api/shipments-client";
import { signHandshakeNonce } from "../crypto/signing";
import { useDeviceKeyBootstrap } from "./use-device-key-bootstrap";
import { getCurrentLocation } from "../lib/location";
import { friendlyErrorMessage } from "../lib/error-messages";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { ApiError } from "@movo/shared/dist/errors/api-error";

export type HandshakeQrStatus =
  | "idle"
  | "generating"
  | "active"
  | "confirmed"
  | "error";

export interface UseHandshakeQrOptions {
  shipmentId: string;
  initialStage?: "pickup" | "delivery";
  onConfirmed?: (shipment: ShipmentSummary) => void;
  /** Caso defensivo del wizard de entrega (MOVO-199 AC7, mismo patrón que
   * `onEvidenceMissing` de `HandshakeScanStep` en MOVO-198): un rechazo por
   * `DELIVERY_EVIDENCE_MISSING` no debería pasar si el gate de evidencia del paso
   * anterior funciona, pero el flujo tiene que degradar bien -- con este callback,
   * el caller decide volver al paso de evidencia en vez de mostrar el error
   * genérico. Opcional y retrocompatible: la pantalla standalone `/handshake` y
   * `/dev-handshake` no lo pasan, sin cambio de comportamiento ahí. */
  onEvidenceMissing?: () => void;
  /** En tests, permite omitir polling o ajustar intervalos */
  pollingIntervalMs?: number;
}

export interface UseHandshakeQrResult {
  status: HandshakeQrStatus;
  qrPayload: string | null;
  stage: "pickup" | "delivery" | null;
  error: string | null;
  confirmedShipment: ShipmentSummary | null;
  deviceKeyStatus: ReturnType<typeof useDeviceKeyBootstrap>["status"];
  retryDeviceKey: () => void;
  /** Reintento manual tras un error. En el camino feliz no hace falta: el QR se
   * renueva solo antes de vencer. */
  regenerate: () => Promise<void>;
}

export const HANDSHAKE_QR_DEFAULT_TTL = 15;
const DEFAULT_POLLING_INTERVAL_MS = 2500;
/** Cuánto antes del vencimiento se pide el nonce siguiente. Generar implica GPS +
 * request + firma (~1s en condiciones normales); con este margen el QR nuevo
 * reemplaza al viejo antes de que el backend lo dé por vencido, sin que la pantalla
 * pase nunca por un estado "expirado". */
export const HANDSHAKE_QR_REFRESH_LEAD_MS = 3000;

/**
 * QR de transferencia de custodia del cedente (MOVO-159). Genera el nonce, lo firma
 * con la clave del dispositivo y lo **renueva solo** antes de que venza (TTL de 15s
 * del backend): mientras se pide el siguiente, se sigue mostrando el actual, así que
 * para el usuario el QR siempre está vigente, sin countdown ni botón de regenerar.
 * Solo un error (GPS, distancia, red) corta la renovación y pide un reintento manual.
 */
export function useHandshakeQr({
  shipmentId,
  initialStage,
  onConfirmed,
  onEvidenceMissing,
  pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
}: UseHandshakeQrOptions): UseHandshakeQrResult {
  const deviceKey = useDeviceKeyBootstrap();

  const [status, setStatus] = useState<HandshakeQrStatus>("idle");
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [stage, setStage] = useState<"pickup" | "delivery" | null>(initialStage ?? null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedShipment, setConfirmedShipment] = useState<ShipmentSummary | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isGeneratingRef = useRef(false);
  const isConfirmedRef = useRef(false);
  // Una generación en vuelo al desmontar no debe agendar otra renovación.
  const isUnmountedRef = useRef(false);
  const currentStageRef = useRef<"pickup" | "delivery" | null>(initialStage ?? null);
  currentStageRef.current = stage;
  // `generate` se agenda a sí mismo para la próxima renovación; el ref evita que el
  // timeout capture una versión vieja del callback.
  const generateRef = useRef<(silent: boolean) => Promise<void>>(async () => {});

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  /** Consulta el envío y, si el receptor de custodia ya confirmó, cierra el flujo.
   * Lo usan el polling y el `catch` de una generación: si el receptor escanea justo
   * antes de una renovación, `generateHandshake` falla contra un envío que ya
   * avanzó de estado, y sin esta consulta el cedente quedaría trabado en un error
   * (con un "Reintentar" que vuelve a fallar) en vez de llegar al éxito. */
  const checkConfirmed = useCallback(async (): Promise<boolean> => {
    if (isConfirmedRef.current) return true;
    const freshShipment = await shipmentsClient.getById(shipmentId);
    const st = currentStageRef.current;

    const isNowConfirmed =
      (st === "pickup" && freshShipment.status === ShipmentStatus.IN_TRANSIT) ||
      (st === "delivery" &&
        (freshShipment.status === ShipmentStatus.DELIVERED ||
          freshShipment.status === ShipmentStatus.COMPLETED));

    if (!isNowConfirmed || isConfirmedRef.current) return isConfirmedRef.current;

    isConfirmedRef.current = true;
    clearRefreshTimer();
    clearPolling();
    if (isUnmountedRef.current) return true;
    setStatus("confirmed");
    setConfirmedShipment(freshShipment);
    onConfirmed?.(freshShipment);
    return true;
  }, [shipmentId, clearRefreshTimer, clearPolling, onConfirmed]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        await checkConfirmed();
      } catch {
        // El polling ignora fallos esporádicos de red
      }
    }, pollingIntervalMs);
  }, [pollingIntervalMs, checkConfirmed]);

  const generate = useCallback(
    async (silent: boolean) => {
      if (isGeneratingRef.current || isConfirmedRef.current) return;
      isGeneratingRef.current = true;
      clearRefreshTimer();
      // Una renovación silenciosa deja el QR actual en pantalla (sigue vigente unos
      // segundos más); solo la primera generación o un reintento muestran el spinner.
      if (!silent) {
        setError(null);
        setStatus("generating");
      }

      try {
        const location = await getCurrentLocation();
        if (!location.granted) {
          throw new LocationDeniedError();
        }

        const generated: GenerateHandshakeResult = await shipmentsClient.generateHandshake(
          shipmentId,
          { lat: location.lat, lng: location.lng },
        );

        setStage(generated.stage);
        currentStageRef.current = generated.stage;

        const signature = await signHandshakeNonce(generated.canonicalPayload);

        // Payload JSON convenido con el receptor (MOVO-160)
        const payloadString = JSON.stringify({
          shipmentId: generated.shipmentId,
          nonce: generated.nonce,
          signature,
        });

        if (isConfirmedRef.current || isUnmountedRef.current) return;

        setQrPayload(payloadString);
        setStatus("active");
        startPolling();

        // Próxima renovación anclada al expiresAt autoritativo del backend (mitiga
        // desfasaje de reloj y latencia de red); fallback al TTL si no viene.
        const ttl = generated.ttlSeconds || HANDSHAKE_QR_DEFAULT_TTL;
        const parsedExpiresAt = generated.expiresAt ? new Date(generated.expiresAt).getTime() : NaN;
        const expiryTimestamp = !isNaN(parsedExpiresAt) ? parsedExpiresAt : Date.now() + ttl * 1000;
        const refreshInMs = Math.max(0, expiryTimestamp - Date.now() - HANDSHAKE_QR_REFRESH_LEAD_MS);

        refreshTimerRef.current = setTimeout(() => {
          void generateRef.current(true);
        }, refreshInMs);
      } catch (err: unknown) {
        clearRefreshTimer();
        clearPolling();
        // Antes de mostrar cualquier error: puede que el fallo sea justamente porque
        // el receptor ya confirmó (el envío dejó de estar en un estado que permita
        // generar). En ese caso no hay error que mostrar, hay que ir al éxito.
        try {
          if (await checkConfirmed()) return;
        } catch {
          // Si la consulta también falla, se muestra el error original.
        }
        if (isUnmountedRef.current) return;
        // AC7: `DELIVERY_EVIDENCE_MISSING`/`PICKUP_EVIDENCE_MISSING` no son un error a
        // mostrar acá -- el caller decide volver al paso de evidencia. Status
        // deliberadamente NO vuelve a "idle" acá: el efecto de disparo automático
        // reintentaría `generate()` en loop contra el mismo motivo mientras el
        // `router.replace` del caller todavía no desmontó este componente.
        if (
          err instanceof ApiError &&
          (err.code === "DELIVERY_EVIDENCE_MISSING" || err.code === "PICKUP_EVIDENCE_MISSING") &&
          onEvidenceMissing
        ) {
          onEvidenceMissing();
          return;
        }
        // Un QR que ya no se puede renovar se saca de pantalla: dejarlo visible
        // haría creer que sigue sirviendo cuando en segundos el backend lo rechaza.
        setQrPayload(null);
        setStatus("error");
        if (err instanceof LocationDeniedError) {
          setError("Necesitamos tu ubicación GPS para generar el código QR de entrega segura.");
        } else if (err instanceof ApiError && err.code === "HANDSHAKE_DISTANCE_EXCEEDED") {
          setError("La distancia entre ambos supera el límite permitido (100 m). Acérquense para confirmar.");
        } else {
          setError(friendlyErrorMessage(err, "No pudimos generar el código QR. Intentá de nuevo."));
        }
      } finally {
        isGeneratingRef.current = false;
      }
    },
    [shipmentId, clearRefreshTimer, clearPolling, startPolling, checkConfirmed, onEvidenceMissing],
  );
  generateRef.current = generate;

  const regenerate = useCallback(() => generate(false), [generate]);

  // Disparo automático inicial si la clave está lista
  useEffect(() => {
    if (deviceKey.status === "ready" && status === "idle") {
      void generate(false);
    }
  }, [deviceKey.status, status, generate]);

  // Limpieza al desmontar
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      clearRefreshTimer();
      clearPolling();
    };
  }, [clearRefreshTimer, clearPolling]);

  return {
    status,
    qrPayload,
    stage,
    error,
    confirmedShipment,
    deviceKeyStatus: deviceKey.status,
    retryDeviceKey: deviceKey.retry,
    regenerate,
  };
}

class LocationDeniedError extends Error {}
