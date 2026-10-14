import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import { useQuery } from "@tanstack/react-query";
import { paymentsClient } from "../api/payments-client";

/**
 * Pago de un envío entregado (MOVO-214). `null` = todavía no hay liquidación (404
 * `SETTLEMENT_NOT_FOUND`: la captura no arrancó), que se muestra como "en proceso". Cuelga de
 * `["shipments", "detail", id]` para que invalidar el detalle también lo refresque.
 *
 * `pollWhileProcessingMs` vuelve a consultar mientras no esté acreditada ni escalada.
 */
export function useShipmentSettlement(
  shipmentId: string | undefined,
  options: { enabled: boolean; pollWhileProcessingMs?: number | false },
) {
  const poll = options.pollWhileProcessingMs ?? false;
  return useQuery<ShipmentSettlementResponse | null>({
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
      const data = query.state.data;
      return data === undefined || data === null || data.status === "processing"
        ? poll
        : false;
    },
  });
}
