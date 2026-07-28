export interface JwtLibraryConfig {
  secret: string;
  issuer: string;
}

let cached: JwtLibraryConfig | undefined;

/**
 * Lee la configuración de JWT desde variables de entorno.
 *
 * Lectura perezosa: solo se ejecuta (y falla si `JWT_SECRET` no está
 * seteado) la primera vez que se llama, no al importar el paquete. Así,
 * un servicio que solo consume `ApiError` o los tipos de dominio no
 * necesita tener `JWT_SECRET` seteado.
 */
export function getJwtConfig(): JwtLibraryConfig {
  if (cached) return cached;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("[@movo/shared] JWT_SECRET env var is required to sign/verify tokens.");
  }

  cached = { secret, issuer: process.env.JWT_ISSUER ?? "movo" };
  return cached;
}

/** Solo para tests: resetea la config memoizada entre casos. */
export function __resetJwtConfigForTests(): void {
  cached = undefined;
}
