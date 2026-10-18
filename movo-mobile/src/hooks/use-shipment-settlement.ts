import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { paymentsClient } from "../api/payments-client";

export const DEFAULT_SETTLEMENT_POLL_TIMEOUT_MS = 120_000;

export interface UseShipmentSettlementOptions {
  enabled: boolean;
  pollWhileProcessingMs?: number | false;
  maxPollingDurationMs?: number;
}

/**
 * Pago de un envío entregado (MOVO-214). `null` = todavía no hay liquidación (404
 * `SETTLEMENT_NOT_FOUND`: la captura no arrancó), que se muestra como "en proceso". Cuelga de
 * `["shipments", "detail", id]` para que invalidar el detalle también lo refresque.
 *
 * `pollWhileProcessingMs` vuelve a consultar mientras no esté acreditada ni escalada, cortando
 * si la consulta da error o si se agota el tope de polling (por defecto 2 min).
 */
export function useShipmentSettlement(
  shipmentId: string | undefined,
  options: UseShipmentSettlementOptions,
) {
  const poll = options.pollWhileProcessingMs ?? false;
  const maxDuration =
    options.maxPollingDurationMs ?? DEFAULT_SETTLEMENT_POLL_TIMEOUT_MS;

  const [isPollingTimedOut, setIsPollingTimedOut] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const prevShipmentIdRef = useRef(shipmentId);
  const prevPollRef = useRef(poll);

  if (prevShipmentIdRef.current !== shipmentId) {
    prevShipmentIdRef.current = shipmentId;
    startedAtRef.current = Date.now();
  }

  if (prevPollRef.current !== poll) {
    const wasPolling = Boolean(prevPollRef.current);
    const isNowPolling = Boolean(poll);
    prevPollRef.current = poll;
    if (!wasPolling && isNowPolling) {
      startedAtRef.current = Date.now();
    }
  }

  const query = useQuery<ShipmentSettlementResponse | null>({
    queryKey: ["shipments", "detail", shipmentId, "settlement"],
    queryFn: async () => {
      try {
        return await paymentsClient.getShipmentSettlement(shipmentId!);
      } catch (error) {
        if (error instanceof ApiError && error.code === "SETTLEMENT_NOT_FOUND")
          return null;
        throw error;
      }
    },
    enabled: options.enabled && !!shipmentId,
    refetchInterval: (query) => {
      if (!poll) return false;
      if (query.state.status === "error") return false;
      const data = query.state.data;
      const isProcessing =
        data === undefined || data === null || data.status === "processing";
      if (!isProcessing) return false;
      if (Date.now() - startedAtRef.current >= maxDuration) {
        return false;
      }
      return poll;
    },
  });

  const isSettled =
    query.data?.status === "credited" || query.data?.status === "escalated";

  useEffect(() => {
    if (!poll || !options.enabled || !shipmentId || isSettled) {
      setIsPollingTimedOut(false);
      return;
    }

    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed >= maxDuration) {
      setIsPollingTimedOut(true);
      return;
    }

    setIsPollingTimedOut(false);
    const timer = setTimeout(() => {
      setIsPollingTimedOut(true);
    }, maxDuration - elapsed);

    return () => clearTimeout(timer);
  }, [poll, options.enabled, shipmentId, maxDuration, isSettled]);

  const queryRefetch = query.refetch;
  const refetch = useCallback(
    async (...args: Parameters<typeof queryRefetch>) => {
      startedAtRef.current = Date.now();
      setIsPollingTimedOut(false);
      return queryRefetch(...args);
    },
    [queryRefetch],
  );

  return {
    ...query,
    refetch,
    isPollingTimedOut,
  };
}
