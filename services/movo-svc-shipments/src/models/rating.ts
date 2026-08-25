import { RatingRole } from "../generated/prisma/client";
import { InvalidEnumValueError } from "./shipment";

export { RatingRole };

/**
 * Modelo de dominio de una calificación post-entrega (MOVO-146). `role` es el rol del
 * CALIFICADO dentro de ESTE envío en particular -- no un rol de cuenta (`UserRole` de
 * `@movo/shared`), el mismo usuario puede calificarse/ser calificado como `sender` en
 * un envío y como `carrier` en otro. Sin consumidor cross-servicio todavía (el
 * agregado que consume `svc-users` vive en MOVO-25) -- se reusa el enum del cliente
 * Prisma directo, mismo criterio incremental que `PackageType`/`PhotoStage`.
 */
export interface Rating {
  id: string;
  shipmentId: string;
  raterId: string;
  rateeId: string;
  role: RatingRole;
  score: number;
  comment: string | null;
  createdAt: Date;
}

export interface CreateRatingInput {
  shipmentId: string;
  raterId: string;
  rateeId: string;
  role: RatingRole;
  score: number;
  comment?: string;
}

const RATING_ROLE_VALUES: ReadonlySet<string> = new Set(Object.values(RatingRole));

/**
 * Mismo patrón que `parseShipmentStatus`/`parseOfferStatus`: un valor de la columna
 * `role` sin equivalente en el enum es drift de schema, no un fallo transitorio.
 */
export function parseRatingRole(value: string, column = "role"): RatingRole {
  if (!RATING_ROLE_VALUES.has(value)) {
    throw new InvalidEnumValueError(column, value);
  }
  return value as RatingRole;
}
