import { ApiError } from "@movo/shared/dist/errors/api-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fundingClient } from "../api/funding-client";
import { BALANCE_QUERY_KEY } from "./use-balance";
import { shouldReconcileAfterPayError } from "../lib/pay-shipment-format";
import { type FundWithTokenInput, type PayShipmentOutcome, fundWithToken } from "../lib/pay-shipment-flow";

/**
 * Datos del pago de un envío (MOVO-269): `carrierPublicKey`, monto y `payUntil`. Sin cache
 * entre visitas (`gcTime: 0`): el plazo y la ventana cambian y un dato viejo haría pagar un
 * envío que el backend ya rechaza. Un 409 (vencido / otro estado) no se reintenta.
 */
export function fundingQueryKey(shipmentId: string | undefined) {
  return ["shipments", "funding", shipmentId] as const;
}

export function useShipmentFunding(shipmentId: string | undefined) {
  return useQuery({
    queryKey: fundingQueryKey(shipmentId),
    queryFn: () => fundingClient.getFunding(shipmentId!),
    enabled: !!shipmentId,
    gcTime: 0,
    staleTime: 0,
    retry: (failureCount, error) => !(error instanceof ApiError && error.statusCode < 500) && failureCount < 2,
  });
}

/** Reserva los fondos con un token ya generado (sin CVV: React Query retiene las variables). No lanza: devuelve el resultado discriminado. */
export function usePayShipment(options?: { onSettled?: (outcome: PayShipmentOutcome) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FundWithTokenInput) => fundWithToken(input),
    onSuccess: (outcome, input) => {
      const id = input.shipmentId;
      // Reservado o vencido: el estado del envío cambió (a `assigned` o de vuelta a `published`). Un error ambiguo también reconcilia: el hold pudo crearse aunque la respuesta no llegara.
      if (outcome.kind === "reserved" || outcome.kind === "unavailable" || outcome.kind === "pending" || shouldReconcileAfterPayError(outcome)) {
        void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
        void queryClient.invalidateQueries({ queryKey: ["shipments", "mine"] });
        void queryClient.invalidateQueries({ queryKey: ["shipments", "active"] });
        void queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
      }
      // Si el emisor absorbió deuda en este pago (recargo), el saldo cambió.
      if (outcome.kind === "reserved") void queryClient.invalidateQueries({ queryKey: BALANCE_QUERY_KEY });
      options?.onSettled?.(outcome);
    },
  });
}
