import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { httpClient } from "./http-client";

/**
 * DTO tal cual lo devuelve `GET /shipments/mine` (`shipmentResponse` en
 * `shipments.schema.ts`, `movo-svc-shipments`, MOVO-80). `pickupDate`/
 * `pickupTimeWindowStart`/`pickupTimeWindowEnd` ya vienen como string formateado
 * (no ISO datetime completo) — ver el fix de timezone documentado en CLAUDE.md, MOVO-80.
 */
export interface ShipmentSummary {
  id: string;
  senderId: string;
  receiverId: string;
  carrierId: string | null;
  packageType: "letter_document" | "standard_package" | "fragile_item";
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  urgent: boolean;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  suggestedPriceArs: number;
  agreedPriceArs: number | null;
  paymentMethod: string | null;
  status: ShipmentStatus;
  lastStatusChangedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListMineResponse {
  items: ShipmentSummary[];
  page: number;
  limit: number;
  total: number;
}

export const shipmentsClient = {
  /** Protegida — `httpClient` adjunta `Authorization` automáticamente vía el
   * interceptor de sesión (MOVO-76). */
  listMine(params?: { page?: number; limit?: number }): Promise<ListMineResponse> {
    return httpClient.get<ListMineResponse>("/shipments/mine", params);
  },
};
