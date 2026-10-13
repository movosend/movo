import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import { receiverTransfersClient } from "../api/receiver-transfers-client";

/** Todo lo que cambia cuando una transferencia avanza: el detalle del envío (receptor,
 * resumen), sus solicitudes en la línea de tiempo, las listas y las invitaciones. */
function invalidateTransferQueries(queryClient: QueryClient, shipmentId: string) {
  queryClient.invalidateQueries({ queryKey: ["shipments", "detail", shipmentId] });
  queryClient.invalidateQueries({ queryKey: ["shipments", "receiver-transfers", shipmentId] });
  queryClient.invalidateQueries({ queryKey: ["shipments", "mine"] });
  queryClient.invalidateQueries({ queryKey: ["receiver-transfers"] });
}

/** MOVO-275 AC7: solicitudes del envío para intercalar en la línea de tiempo. Carga y
 * falla independiente del resto, mismo criterio que `useShipmentEvents`. */
export function useShipmentReceiverTransfers(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ["shipments", "receiver-transfers", shipmentId],
    queryFn: () => receiverTransfersClient.listForShipment(shipmentId!),
    enabled: !!shipmentId,
  });
}

/** MOVO-275 AC8: invitaciones vigentes para "Requiere tu atención". */
export function useReceiverTransferInvitations() {
  return useQuery({
    queryKey: ["receiver-transfers", "invitations"],
    queryFn: () => receiverTransfersClient.listMyInvitations(),
  });
}

export function useReceiverTransfer(transferId: string | undefined) {
  return useQuery({
    queryKey: ["receiver-transfers", "detail", transferId],
    queryFn: () => receiverTransfersClient.getById(transferId!),
    enabled: !!transferId,
  });
}

export function useRequestReceiverTransfer() {
  const queryClient = useQueryClient();
  return useMutation<
    ReceiverTransferRequest,
    unknown,
    { shipmentId: string; newReceiverId: string; reason?: string }
  >({
    mutationFn: ({ shipmentId, newReceiverId, reason }) =>
      receiverTransfersClient.request(shipmentId, { newReceiverId, ...(reason ? { reason } : {}) }),
    onSuccess: (transfer) => invalidateTransferQueries(queryClient, transfer.shipmentId),
  });
}

export function useAcceptReceiverTransfer() {
  const queryClient = useQueryClient();
  return useMutation<ReceiverTransferRequest, unknown, { transferId: string }>({
    mutationFn: ({ transferId }) => receiverTransfersClient.accept(transferId),
    onSuccess: (transfer) => invalidateTransferQueries(queryClient, transfer.shipmentId),
  });
}

export function useRejectReceiverTransfer() {
  const queryClient = useQueryClient();
  return useMutation<ReceiverTransferRequest, unknown, { transferId: string; reason?: string }>({
    mutationFn: ({ transferId, reason }) => receiverTransfersClient.reject(transferId, reason),
    onSuccess: (transfer) => invalidateTransferQueries(queryClient, transfer.shipmentId),
  });
}

export function useCancelReceiverTransfer() {
  const queryClient = useQueryClient();
  return useMutation<ReceiverTransferRequest, unknown, { transferId: string }>({
    mutationFn: ({ transferId }) => receiverTransfersClient.cancel(transferId),
    onSuccess: (transfer) => invalidateTransferQueries(queryClient, transfer.shipmentId),
  });
}
