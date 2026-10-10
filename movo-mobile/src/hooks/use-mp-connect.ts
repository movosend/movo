import {
  MP_CONNECT_RETURN_URL,
  type MpConnectStatusResponse,
} from "@movo/shared/dist/types/mp-connect";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { paymentsClient } from "../api/payments-client";
import { friendlyErrorMessage, messageForCode } from "../lib/error-messages";
import { runMpConnectLink } from "../lib/mp-connect-flow";

export const MP_CONNECT_STATUS_QUERY_KEY = ["payments", "mp-connect", "status"] as const;

const UNLINKED_STATUS: MpConnectStatusResponse = {
  status: "unlinked",
  account: null,
  invalidReason: null,
};

/**
 * Un solo listener de AppState para todas las instancias de `useMpConnectStatus` (fila de
 * Perfil + pantalla "Pagos y cobros"): uno por instancia hacía un refetch por cada una al
 * volver a primer plano. Mientras se vincula no refetchea: al cerrarse el navegador el
 * AppState pasa a `active` y el flujo ya consulta el status por su cuenta.
 */
let foregroundSubscribers = 0;
let foregroundSubscription: { remove: () => void } | null = null;
let linkInFlight = false;

function subscribeToForegroundRefetch(queryClient: QueryClient): () => void {
  foregroundSubscribers += 1;
  if (foregroundSubscribers === 1) {
    foregroundSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && !linkInFlight) {
        void queryClient.refetchQueries({ queryKey: MP_CONNECT_STATUS_QUERY_KEY });
      }
    });
  }
  return () => {
    foregroundSubscribers -= 1;
    if (foregroundSubscribers === 0) {
      foregroundSubscription?.remove();
      foregroundSubscription = null;
    }
  };
}

/**
 * Estado de la vinculación con Mercado Pago (MOVO-112). Lo comparten la fila de
 * Perfil → Configuración y la pantalla "Pagos y cobros" con la misma query key. Se
 * vuelve a consultar al volver la app a primer plano: el transportista puede haber
 * revocado el acceso desde la app de Mercado Pago.
 */
export function useMpConnectStatus() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: MP_CONNECT_STATUS_QUERY_KEY,
    queryFn: paymentsClient.getMpConnectStatus,
    staleTime: 30_000,
  });

  useEffect(() => subscribeToForegroundRefetch(queryClient), [queryClient]);

  return query;
}

export function useUnlinkMpAccount(options?: {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: paymentsClient.unlinkMpAccount,
    onSuccess: () => {
      queryClient.setQueryData(MP_CONNECT_STATUS_QUERY_KEY, UNLINKED_STATUS);
      options?.onSuccess?.();
    },
    onError: options?.onError,
  });
}

/**
 * - `idle`: nada en curso.
 * - `opening`: pidiendo la URL de autorización al backend.
 * - `browser`: el navegador embebido de Mercado Pago está abierto.
 * - `finishing`: el navegador se cerró y se está volviendo a consultar el status.
 */
export type MpLinkPhase = "idle" | "opening" | "browser" | "finishing";

/**
 * Orquesta la vinculación: pide la URL, la abre con `openAuthSessionAsync` (navegador
 * embebido, nunca `Linking.openURL`) y vuelve a consultar el status al volver. El
 * resultado que se muestra sale del status, no del deep link (ver `mp-connect-flow.ts`).
 */
export function useLinkMpAccount() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<MpLinkPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    linkInFlight = true;
    setError(null);
    setPhase("opening");
    let browserClosed = false;

    try {
      const outcome = await runMpConnectLink({
        getAuthorizationUrl: async () => {
          const { authorizationUrl } = await paymentsClient.getMpConnectAuthorizationUrl();
          setPhase("browser");
          return authorizationUrl;
        },
        openAuthSession: (url) =>
          WebBrowser.openAuthSessionAsync(url, MP_CONNECT_RETURN_URL, {
            // Sin cookies compartidas con Safari: no queda logueada otra cuenta de MP
            // (clave en sandbox para alternar cuentas de prueba). Solo iOS.
            preferEphemeralSession: true,
          }),
        onBrowserClosed: () => {
          browserClosed = true;
          setPhase("finishing");
        },
        refetchStatus: async () => {
          const status = await queryClient.fetchQuery({
            queryKey: MP_CONNECT_STATUS_QUERY_KEY,
            queryFn: paymentsClient.getMpConnectStatus,
            staleTime: 0,
          });
          return status.status;
        },
      });

      if (outcome.kind === "error") {
        setError(
          outcome.code
            ? messageForCode(outcome.code, outcome.fallbackMessage)
            : outcome.fallbackMessage,
        );
      }
    } catch (err) {
      setError(
        friendlyErrorMessage(
          err,
          browserClosed
            ? "No pudimos confirmar la vinculación. Probá de nuevo."
            : "No pudimos iniciar la vinculación con Mercado Pago. Probá de nuevo.",
        ),
      );
    } finally {
      inFlight.current = false;
      linkInFlight = false;
      setPhase("idle");
    }
  }, [queryClient]);

  const clearError = useCallback(() => setError(null), []);

  return { start, phase, error, clearError };
}
