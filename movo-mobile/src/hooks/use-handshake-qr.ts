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
import { ShipmentStatus, ApiError } from "@movo/shared";

export type HandshakeQrStatus =
  | "idle"
  | "generating"
  | "active"
  | "expired"
  | "confirmed"
  | "error";

export interface UseHandshakeQrOptions {
  shipmentId: string;
  initialStage?: "pickup" | "delivery";
  onConfirmed?: (shipment: ShipmentSummary) => void;
  /** En tests, permite omitir polling o ajustar intervalos */
  pollingIntervalMs?: number;
}

export interface UseHandshakeQrResult {
  status: HandshakeQrStatus;
  qrPayload: string | null;
  stage: "pickup" | "delivery" | null;
  secondsLeft: number;
  totalSeconds: number;
  progressPercent: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
  error: string | null;
  confirmedShipment: ShipmentSummary | null;
  deviceKeyStatus: ReturnType<typeof useDeviceKeyBootstrap>["status"];
  retryDeviceKey: () => void;
  regenerate: () => Promise<void>;
}

export const HANDSHAKE_QR_DEFAULT_TTL = 15;
const DEFAULT_POLLING_INTERVAL_MS = 2500;

export function useHandshakeQr({
  shipmentId,
  initialStage,
  onConfirmed,
  pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
}: UseHandshakeQrOptions): UseHandshakeQrResult {
  const deviceKey = useDeviceKeyBootstrap();

  const [status, setStatus] = useState<HandshakeQrStatus>("idle");
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [stage, setStage] = useState<"pickup" | "delivery" | null>(initialStage ?? null);
  const [totalSeconds, setTotalSeconds] = useState<number>(HANDSHAKE_QR_DEFAULT_TTL);
  const [secondsLeft, setSecondsLeft] = useState<number>(HANDSHAKE_QR_DEFAULT_TTL);
  const [error, setError] = useState<string | null>(null);
  const [confirmedShipment, setConfirmedShipment] = useState<ShipmentSummary | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isGeneratingRef = useRef(false);
  const currentStageRef = useRef<"pickup" | "delivery" | null>(initialStage ?? null);
  currentStageRef.current = stage;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const handleExpiration = useCallback(() => {
    clearTimer();
    clearPolling();
    setStatus("expired");
    setSecondsLeft(0);
  }, [clearTimer, clearPolling]);

  const generate = useCallback(async () => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    clearTimer();
    clearPolling();
    setError(null);
    setStatus("generating");

    try {
      // 1. Verificar GPS
      const location = await getCurrentLocation();
      if (!location.granted) {
        setStatus("error");
        setError("Necesitamos tu ubicación GPS para generar el código QR de entrega segura.");
        return;
      }

      // 2. Llamar a POST /shipments/:id/handshake/generate
      const generated: GenerateHandshakeResult = await shipmentsClient.generateHandshake(
        shipmentId,
        { lat: location.lat, lng: location.lng },
      );

      setStage(generated.stage);
      currentStageRef.current = generated.stage;

      // 3. Firmar el payload canónico client-side (MOVO-195)
      const signature = await signHandshakeNonce(generated.canonicalPayload);

      // 4. Armar el payload JSON convenido para el QR (MOVO-160)
      const payloadString = JSON.stringify({
        shipmentId: generated.shipmentId,
        nonce: generated.nonce,
        signature,
      });

      const ttl = generated.ttlSeconds || HANDSHAKE_QR_DEFAULT_TTL;
      setQrPayload(payloadString);
      setTotalSeconds(ttl);
      setSecondsLeft(ttl);
      setStatus("active");

      // Iniciar cuenta regresiva (15s a 0s)
      const expiryTimestamp = Date.now() + ttl * 1000;
      timerRef.current = setInterval(() => {
        const remainingMs = expiryTimestamp - Date.now();
        const remSecs = Math.max(0, Math.ceil(remainingMs / 1000));
        setSecondsLeft(remSecs);

        if (remSecs <= 0) {
          handleExpiration();
        }
      }, 500);

      // Iniciar polling para detectar confirmación de la contraparte
      pollingRef.current = setInterval(async () => {
        try {
          const freshShipment = await shipmentsClient.getById(shipmentId);
          const st = currentStageRef.current;

          const isNowConfirmed =
            (st === "pickup" && freshShipment.status === ShipmentStatus.IN_TRANSIT) ||
            (st === "delivery" &&
              (freshShipment.status === ShipmentStatus.DELIVERED ||
                freshShipment.status === ShipmentStatus.COMPLETED));

          if (isNowConfirmed) {
            clearTimer();
            clearPolling();
            setStatus("confirmed");
            setConfirmedShipment(freshShipment);
            onConfirmed?.(freshShipment);
          }
        } catch {
          // El polling ignora fallos esporádicos de red
        }
      }, pollingIntervalMs);
    } catch (err: unknown) {
      clearTimer();
      clearPolling();
      setStatus("error");
      if (err instanceof ApiError && err.code === "HANDSHAKE_DISTANCE_EXCEEDED") {
        setError("La distancia entre ambos supera el límite permitido (100 m). Acérquense para confirmar.");
      } else {
        setError(friendlyErrorMessage(err, "No pudimos generar el código QR. Intentá de nuevo."));
      }
    } finally {
      isGeneratingRef.current = false;
    }
  }, [
    shipmentId,
    clearTimer,
    clearPolling,
    handleExpiration,
    onConfirmed,
    pollingIntervalMs,
  ]);

  // Disparo automático inicial si la clave está lista
  useEffect(() => {
    if (deviceKey.status === "ready" && status === "idle") {
      void generate();
    }
  }, [deviceKey.status, status, generate]);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      clearTimer();
      clearPolling();
    };
  }, [clearTimer, clearPolling]);

  const isExpired = status === "expired" || secondsLeft <= 0;
  const isExpiringSoon = secondsLeft <= 5 && !isExpired && status === "active";
  const progressPercent = Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100));

  return {
    status,
    qrPayload,
    stage,
    secondsLeft,
    totalSeconds,
    progressPercent,
    isExpiringSoon,
    isExpired,
    error,
    confirmedShipment,
    deviceKeyStatus: deviceKey.status,
    retryDeviceKey: deviceKey.retry,
    regenerate: generate,
  };
}
