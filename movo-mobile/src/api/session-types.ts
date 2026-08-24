import type { KycStatus, UserRole } from "@movo/shared/dist/types/user";

/**
 * Shape común de la respuesta de `register()`/`login()`/`refresh()` en
 * `movo-svc-users` (mismo contrato desde PR #51 de MOVO-72: el registro autentica
 * igual que el login). Vive en un módulo propio, sin depender de `auth-client.ts` ni
 * de `http-client.ts`, para que ambos lo puedan importar sin crear un ciclo — el
 * interceptor de `http-client.ts` (MOVO-76) necesita este shape para tipar el
 * resultado de `POST /auth/refresh` sin importar `auth-client.ts` (que a su vez
 * importa `httpClient` de `http-client.ts`).
 */
export interface SessionResponse {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  kycStatus: KycStatus;
  fullName: string;
  roles: UserRole[];
}
