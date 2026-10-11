import type {
  ReceiverTransferInvitation,
  ReceiverTransferRequest,
} from "@movo/shared/dist/types/receiver-transfer";
import { httpClient } from "./http-client";

/**
 * MOVO-275 (ADR-037): transferencia de receptor. Pedirla y listarla cuelgan del envío
 * (`/shipments/:id/...`); aceptar, rechazar, cancelar y las invitaciones viven bajo
 * `/receiver-transfers`.
 */
export const receiverTransfersClient = {
  /** El receptor actual invita a otra persona a recibir en su lugar. */
  request(
    shipmentId: string,
    body: { newReceiverId: string; reason?: string },
  ): Promise<ReceiverTransferRequest> {
    return httpClient.post<ReceiverTransferRequest>(`/shipments/${shipmentId}/receiver-transfer`, body);
  },

  /** Solicitudes del envío para la línea de tiempo, ya filtradas por quien mira. */
  listForShipment(shipmentId: string): Promise<ReceiverTransferRequest[]> {
    return httpClient.get<ReceiverTransferRequest[]>(`/shipments/${shipmentId}/receiver-transfers`);
  },

  /** Invitaciones vigentes del usuario, para "Requiere tu atención". */
  listMyInvitations(): Promise<ReceiverTransferInvitation[]> {
    return httpClient.get<ReceiverTransferInvitation[]>("/receiver-transfers/invitations");
  },

  getById(transferId: string): Promise<ReceiverTransferInvitation> {
    return httpClient.get<ReceiverTransferInvitation>(`/receiver-transfers/${transferId}`);
  },

  accept(transferId: string): Promise<ReceiverTransferRequest> {
    return httpClient.post<ReceiverTransferRequest>(`/receiver-transfers/${transferId}/accept`, {});
  },

  reject(transferId: string, reason?: string): Promise<ReceiverTransferRequest> {
    return httpClient.post<ReceiverTransferRequest>(
      `/receiver-transfers/${transferId}/reject`,
      reason ? { reason } : {},
    );
  },

  cancel(transferId: string): Promise<ReceiverTransferRequest> {
    return httpClient.post<ReceiverTransferRequest>(`/receiver-transfers/${transferId}/cancel`, {});
  },
};
