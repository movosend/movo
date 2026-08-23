import { AccountStatus, KycStatus, UserRole } from "./user";

/**
 * Insignias calculadas desde el estado real del usuario (MOVO-77 AC5). `"kyc_verified"`
 * es identidad; `"license_verified"` (MOVO-15) es licencia de conducir. En inglés a
 * propósito (review de PR #55, tmvergara): es un valor que el móvil matchea, y el
 * resto de los enums de wire contract (`UserRole`, `KycStatus`, `AccountStatus`) ya
 * están en inglés.
 */
export type ProfileBadge = "kyc_verified" | "license_verified";

/**
 * Contadores de transacciones por rol. Sin tablas de envíos todavía (MOVO-25) — el
 * contrato queda fijo con ceros para que el móvil no necesite cambios cuando el dato
 * exista de verdad (AC6).
 */
export interface TransactionCounts {
  asSender: number;
  asCarrier: number;
}

/**
 * Perfil completo del usuario autenticado (`GET /users/me`, MOVO-77 AC1). Wire contract
 * de este endpoint — nunca se expone en la proyección pública.
 *
 * **No incluye `phoneVerified`/`dni`/`birthdate`** (review de PR #55, tmvergara):
 * AC1 no los pide, y quedan afuera a propósito hasta confirmar con quien implemente
 * MOVO-31 (editar datos personales) si hacen falta.
 */
export interface PrivateProfile {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  /**
   * MOVO-139: el usuario probó posesión de esta dirección vía OTP. Es el dato que la
   * pantalla de perfil usa para mostrar la insignia de email verificado y el CTA de
   * verificación (MOVO-135), en paralelo a la que ya existe para el teléfono. Un email
   * sin verificar no bloquea operar -- no hay gate duro, solo se refleja en el perfil.
   */
  emailVerified: boolean;
  phone: string;
  photoUrl: string | null;
  kycStatus: KycStatus;
  /** Estado de la verificación de licencia de conducir (MOVO-15) — mismo enum que
   * `kycStatus` (identidad), columna separada en `User.kycStatusLicense`. No vive en
   * `PublicProfile`: la insignia (`badges`) ya comunica el resultado ahí, mismo
   * criterio que `kycStatus` (identidad) tampoco vive en esa proyección. */
  licenseKycStatus: KycStatus;
  accountStatus: AccountStatus;
  roles: UserRole[];
  badges: ProfileBadge[];
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
}

/**
 * Proyección pública de cualquier usuario (`GET /users/:id`, MOVO-77 AC2). Tipo
 * separado a propósito (no un `Omit`/flag sobre `PrivateProfile`, AC3): nunca puede
 * tener `email`/`phone`/`accountStatus` porque esos campos no existen en este tipo.
 */
export interface PublicProfile {
  id: string;
  fullName: string;
  photoUrl: string | null;
  isVerified: boolean;
  badges: ProfileBadge[];
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
}
