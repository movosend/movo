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
 * Contadores de transacciones por rol -- envíos `delivered` como emisor/transportista
 * (MOVO-152, wired a `GET /internal/users/:id/reputation` de `svc-shipments`/MOVO-147).
 */
export interface TransactionCounts {
  asSender: number;
  asCarrier: number;
}

/**
 * MOVO-152: score de reputación ponderado (shrinkage bayesiano + decaimiento temporal,
 * ver `services/movo-svc-shipments/src/domain/reputation.ts`) restringido a un
 * subconjunto de calificaciones -- misma forma que usa internamente `svc-shipments`
 * para el resultado global y para `asSender`/`asCarrier`. `reputationScore` es `null`
 * únicamente sin ninguna calificación (nunca `0` -- un cero es una nota pésima, no
 * ausencia de datos). `isNewProfile` (menos de 3 calificaciones) es una decisión de
 * presentación: el perfil muestra "Perfil nuevo" en vez del score, pero el cálculo
 * viaja siempre.
 */
export interface ReputationBreakdown {
  reputationScore: number | null;
  ratingCount: number;
  isNewProfile: boolean;
  /**
   * Promedio por sub-categoría (puntualidad/cuidado/comunicación del transportista;
   * paquete listo/dirección clara/comunicación del emisor) — MOVO-173, todavía sin
   * backend. `undefined` en cualquier respuesta actual; los consumidores (mobile)
   * ocultan la fila de barras entera mientras no llegue, nunca la rellenan con ceros.
   */
  categories?: ReputationCategoryScore[];
  /**
   * Subconjunto de las stats de uso del rediseño de perfil que es calculable con
   * datos que ya existen (MOVO-170) — "recorridos"/"a tiempo"/"responde en X" quedan
   * afuera a propósito, ver esa issue. `undefined` hasta que el backend lo resuelva.
   */
  usageStats?: UsageStats;
}

/** MOVO-173 (calificación por categorías, sin backend todavía). */
export interface ReputationCategoryScore {
  key: string;
  label: string;
  score: number;
}

/** MOVO-170 (enriquecimiento de perfil, sin backend todavía). */
export interface UsageStats {
  delivered: number;
  cancelled: number;
  avgPackageWeightKg: number | null;
}

/**
 * MOVO-152 AC2: una de las últimas 10 calificaciones recibidas por el usuario, leídas
 * de `GET /internal/users/:id/ratings/recent` (`svc-shipments`, MOVO-146 AC10) al
 * componer un perfil completo. `raterId` viaja crudo -- resolverlo a un perfil (nombre/
 * foto de quien calificó) queda para quien consuma este tipo (ej. el mobile de
 * MOVO-154), no es responsabilidad de `svc-users` acá.
 */
export interface RecentRatingComment {
  id: string;
  raterId: string;
  /**
   * Nombre de quien calificó (MOVO-170, todavía sin backend — hoy siempre
   * `undefined`, el `raterId` viaja anónimo de cara al calificado). Cuando llegue,
   * es una decisión de producto ya tomada, no solo técnica — ver esa issue.
   */
  raterName?: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

/**
 * Perfil completo del usuario autenticado (`GET /users/me`, MOVO-77 AC1). Wire contract
 * de este endpoint — nunca se expone en la proyección pública.
 *
 * **No incluye `birthdate`** (review de PR #55, tmvergara): AC1 no lo pide. `dni` y
 * `phoneVerified` quedaban en la misma bolsa "hasta confirmar con quien implemente
 * MOVO-31 (editar datos personales)" — MOVO-135 los confirmó: la pantalla de editar
 * perfil muestra el DNI como dato de solo lectura y una insignia de verificación
 * junto al teléfono, así que ambos pasaron a formar parte de esta proyección.
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
  /** Documento de identidad. `null` para las cuentas creadas antes de que el
   * registro lo pidiera. Nunca editable: con KYC aprobado quedó validado contra el
   * documento por Didit, y sin KYC todavía no hay flujo que permita corregirlo. */
  dni: string | null;
  /**
   * Si el teléfono se probó por OTP (al registrarse, MOVO-71, o al cambiarlo,
   * MOVO-133). **No existe el equivalente para el email**: el proyecto no tiene
   * ningún `EmailProvider` ni columna `email_verified`, por eso el OTP del cambio de
   * email viaja al teléfono. No inventar una insignia de "email verificado" sobre
   * este campo — habla solo del teléfono.
   */
  phoneVerified: boolean;
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
  /** Bio de texto libre (MOVO-171, todavía sin backend) — `undefined` hasta que
   * exista la columna; una vez agregada, `string | null` (nunca cargada todavía). */
  bio?: string | null;
}

/** MOVO-172 (ficha de vehículo del transportista, todavía sin backend). */
export interface VehicleProfile {
  brand: string;
  model: string;
  cargoCapacityLabel: string;
  licensePlate: string;
}

/**
 * Proyección pública de cualquier usuario (`GET /users/:id`, MOVO-77 AC2). Tipo
 * separado a propósito (no un `Omit`/flag sobre `PrivateProfile`, AC3): nunca puede
 * tener `email`/`phone`/`accountStatus` porque esos campos no existen en este tipo.
 *
 * MOVO-152 AC2 sumó el desglose por rol (`asSender`/`asCarrier` -- la reputación que
 * importa al elegir una oferta es la de transportista), `isNewProfile` y los
 * comentarios recientes -- solo a esta proyección, no a `PrivateProfile` (ver el AC:
 * "se agrega al contrato del perfil público"). `recentRatingComments` viaja vacío en
 * `GET /users/search` (composición liviana, sin la llamada extra a `ratings/recent`
 * por cada resultado) y poblado en `GET /users/:id` (perfil completo) -- el tipo no
 * distingue los dos casos, es una decisión de qué datos pedir al componer, no del wire
 * contract.
 */
export interface PublicProfile {
  id: string;
  fullName: string;
  photoUrl: string | null;
  isVerified: boolean;
  badges: ProfileBadge[];
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
  ratingCount: number;
  isNewProfile: boolean;
  asSender: ReputationBreakdown;
  asCarrier: ReputationBreakdown;
  recentRatingComments: RecentRatingComment[];
  /** MOVO-170, todavía sin backend — `undefined` hasta que se exponga. */
  memberSince?: string;
  /** MOVO-170, todavía sin backend — mismos booleanos que ya expone
   * `PrivateProfile`, sin filtrar el teléfono/email real. */
  phoneVerified?: boolean;
  emailVerified?: boolean;
  /** MOVO-171, todavía sin backend. */
  bio?: string | null;
  /** MOVO-172, todavía sin backend — `null`/`undefined` si no es transportista o
   * no cargó ficha de vehículo. */
  vehicle?: VehicleProfile | null;
}
