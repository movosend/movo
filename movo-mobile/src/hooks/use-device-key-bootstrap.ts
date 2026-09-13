import { useEffect, useRef, useState } from "react";
import { usersClient } from "../api/users-client";
import { getOrCreateDeviceKeyPair } from "../crypto/keypair";
import { useAuthStore } from "../store/auth-store";

export type DeviceKeyBootstrapStatus = "idle" | "pending" | "ready" | "error";

export interface DeviceKeyBootstrap {
  status: DeviceKeyBootstrapStatus;
  /** Reintenta generar/registrar la clave a demanda -- ignora el guard de "una vez
   * por login" (ese guard es solo para el disparo automático). */
  retry: () => void;
}

/**
 * AC1 de MOVO-195: en el primer login del dispositivo, obtiene (genera si hace falta)
 * el par de claves del handshake (`src/crypto/keypair.ts`, ADR-020) y registra la
 * pública contra `POST /users/me/device-key` (MOVO-157). Mismo patrón de guard con
 * `useRef` que `usePushNotifications` (dispara una sola vez por transición a
 * `sessionStatus === "authenticated"`, se resetea al des-autenticar).
 *
 * A diferencia del registro de push (best-effort silencioso para siempre, MOVO-107),
 * el AC7 de este ticket exige que un fallo sea **detectable y accionable** -- nunca se
 * traga el error. Se expone `status`/`retry()` para que una pantalla que dependa del
 * handshake (`MOVO-159`/`MOVO-160`, fuera de este ticket) pueda gatear la entrada en
 * vez de dejar que el usuario llegue al momento del retiro/entrega y falle recién ahí.
 */
export function useDeviceKeyBootstrap(): DeviceKeyBootstrap {
  const sessionStatus = useAuthStore((s) => s.status);
  const [status, setStatus] = useState<DeviceKeyBootstrapStatus>("idle");
  const statusRef = useRef<DeviceKeyBootstrapStatus>("idle");
  statusRef.current = status;
  const autoAttemptedRef = useRef(false);

  async function attemptRegistration(): Promise<void> {
    if (statusRef.current === "pending") return;
    setStatus("pending");
    try {
      const { publicKeyBase64 } = await getOrCreateDeviceKeyPair();
      await usersClient.registerDeviceKey(publicKeyBase64);
      setStatus("ready");
    } catch (error) {
      console.warn("[handshake] no se pudo generar/registrar la clave del dispositivo", error);
      setStatus("error");
    }
  }

  useEffect(() => {
    if (sessionStatus !== "authenticated") {
      autoAttemptedRef.current = false;
      setStatus("idle");
      return;
    }
    if (autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;
    void attemptRegistration();
  }, [sessionStatus]);

  return { status, retry: () => void attemptRegistration() };
}
