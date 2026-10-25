import type { TransactionListItem } from "@movo/shared/dist/types/transaction";
import { useQuery } from "@tanstack/react-query";
import { paymentsClient } from "../api/payments-client";

/**
 * La reserva de fondos más reciente que el emisor hizo para un envío (MOVO-308, MOVO-318), o `null`
 * si nunca llegó a reservar. Alimenta el sheet de cancelación en `assigned` (para usar el monto real
 * del hold, que incluye cualquier deuda cobrada en MOVO-311) y la card "Tu pago" de un envío cancelado.
 * Cuelga de `["shipments", "detail", id]` para que invalidar el detalle (al cancelar) también la refresque.
 */
export function useShipmentHold(shipmentId: string | undefined, options: { enabled: boolean }) {
  return useQuery<TransactionListItem | null>({
    queryKey: ["shipments", "detail", shipmentId, "hold"],
    queryFn: async () => {
      const page = await paymentsClient.listShipmentSenderTransactions(shipmentId!);
      return page.items[0] ?? null;
    },
    enabled: options.enabled && !!shipmentId,
  });
}
