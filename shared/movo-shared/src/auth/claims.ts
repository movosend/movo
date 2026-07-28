import { KycStatus, UserRole } from "../types/user";

/** Claims del JWT de acceso, ver ADR-004. */
export interface AccessTokenClaims {
  sub: string;
  roles: UserRole[];
  kycStatus: KycStatus;
  iat: number;
  exp: number;
  iss: string;
}
