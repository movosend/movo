import { ChatReportParties, ShipmentParties } from "@movo/shared";
import {
  createInternalClient,
  InternalClient,
  isNullableString,
  isRecord,
  isString,
  isStringArray,
  RequestContext,
} from "./internal-client";

export interface ShipmentsClient extends InternalClient {
  /** `GET /internal/shipments/:id/parties`. `null` si el envío no existe. */
  getShipmentParties(shipmentId: string, ctx: RequestContext): Promise<ShipmentParties | null>;
  /** `GET /internal/chat-reports/:id/parties`. `null` si el reporte no existe. */
  getChatReportParties(reportId: string, ctx: RequestContext): Promise<ChatReportParties | null>;
}

const isShipmentParties = (body: unknown): body is ShipmentParties =>
  isRecord(body) &&
  isString(body.shipmentId) &&
  isString(body.senderId) &&
  isNullableString(body.carrierId) &&
  isNullableString(body.receiverId) &&
  isStringArray(body.formerReceiverIds);

const isChatReportParties = (body: unknown): body is ChatReportParties =>
  isRecord(body) &&
  isString(body.reportId) &&
  isString(body.shipmentId) &&
  isString(body.reporterId) &&
  isStringArray(body.partyIds);

export function createShipmentsClient(config: { SHIPMENTS_SERVICE_URL: string }): ShipmentsClient {
  const client = createInternalClient({
    baseUrl: config.SHIPMENTS_SERVICE_URL,
    serviceLabel: "envíos",
    unavailableCode: "SHIPMENTS_SERVICE_UNAVAILABLE",
  });

  return {
    ...client,
    getShipmentParties(shipmentId, ctx) {
      return client.request(`/internal/shipments/${encodeURIComponent(shipmentId)}/parties`, ctx, {
        isValid: isShipmentParties,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
    getChatReportParties(reportId, ctx) {
      return client.request(`/internal/chat-reports/${encodeURIComponent(reportId)}/parties`, ctx, {
        isValid: isChatReportParties,
        notFoundCodes: ["NOT_FOUND"],
      });
    },
  };
}
