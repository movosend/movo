/**
 * Barrel de exports de @movo/shared.
 *
 * Convención (zona de conflicto crítica, ver MOVO-67): cada dominio tiene
 * su propio bloque de comentario. Al agregar un nuevo export, sumá una
 * línea al final del bloque de tu dominio — nunca reordenes las líneas
 * existentes ni las de otro dominio.
 */

// auth
export { signAccessToken, signRefreshToken, verifyAccessToken } from "./auth/jwt";
export type {
  AccessTokenPayload,
  RefreshTokenResult,
  VerifyAccessTokenResult,
} from "./auth/jwt";
export type { AccessTokenClaims } from "./auth/claims";

// errors
export { ApiError } from "./errors/api-error";
export type { ApiErrorCode, SerializedApiError } from "./errors/api-error";

// types
export { UserRole, KycStatus, AccountStatus } from "./types/user";
export { ShipmentStatus } from "./types/shipment";
export { OfferStatus } from "./types/offer";
export { TripStatus } from "./types/trip";
export type {
  ProfileBadge,
  TransactionCounts,
  PrivateProfile,
  PublicProfile,
} from "./types/user-profile";
export type { Address, CreateAddressInput, UpdateAddressInput } from "./types/address";
export { PriceCalculationMethod } from "./types/pricing";
export type { QuoteRequest, QuoteResponse, PriceBreakdownItem } from "./types/pricing";
