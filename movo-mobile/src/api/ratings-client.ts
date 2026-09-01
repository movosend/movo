import { httpClient } from "./http-client";

export type RatingRole = "sender" | "carrier" | "receiver";

/**
 * DTO tal cual lo devuelve `POST /shipments/:id/ratings`, `PATCH /shipments/:id/ratings/:rateeId`
 * y `GET /shipments/:id/ratings` (`ratingResponse` en `ratings.schema.ts`, `movo-svc-shipments`,
 * MOVO-146 / MOVO-153).
 */
export interface Rating {
  id: string;
  shipmentId: string;
  raterId: string;
  rateeId: string;
  role: RatingRole;
  score: number;
  comment: string | null;
  createdAt: string;
}

export interface CreateRatingInput {
  rateeId: string;
  score: number;
  comment?: string;
}

export interface UpdateRatingInput {
  score: number;
  comment?: string;
}

export const ratingsClient = {
  /**
   * `POST /shipments/:id/ratings` (MOVO-146 / MOVO-153)
   * Crea una nueva calificación post-entrega para una contraparte del envío.
   */
  createRating(shipmentId: string, input: CreateRatingInput): Promise<Rating> {
    return httpClient.post<Rating>(`/shipments/${shipmentId}/ratings`, input);
  },

  /**
   * `PATCH /shipments/:id/ratings/:rateeId` (MOVO-146 / MOVO-153)
   * Edita una calificación propia existente dentro de la ventana de 72hs.
   */
  updateRating(shipmentId: string, rateeId: string, input: UpdateRatingInput): Promise<Rating> {
    return httpClient.patch<Rating>(`/shipments/${shipmentId}/ratings/${rateeId}`, input);
  },

  /**
   * `GET /shipments/:id/ratings` (MOVO-146 / MOVO-153)
   * Obtiene la lista de calificaciones realizadas para este envío.
   */
  listShipmentRatings(shipmentId: string): Promise<Rating[]> {
    return httpClient.get<Rating[]>(`/shipments/${shipmentId}/ratings`);
  },
};
