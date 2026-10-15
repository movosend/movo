import { KycStatus, UserRole } from "../types/user";

/** Claims del JWT de acceso, ver ADR-004. */
export interface AccessTokenClaims {
  sub: string;
  roles: UserRole[];
  kycStatus: KycStatus;
  /**
   * MOVO-287 (review de PR #244): `"panel"` en los tokens emitidos por la sesión del panel.
   * El gateway solo respeta el rol `admin` si viene con este claim: deducirlo de los roles
   * dejaba que un token de la app emitido antes del deploy (con `admin`) siguiera valiendo
   * como admin. Ausente en los tokens de la app.
   */
  session?: "panel";
  iat: number;
  exp: number;
  iss: string;
}
