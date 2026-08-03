import { describe, it, expect } from "vitest";
import { UserRole, KycStatus } from "@movo/shared";
import {
  mapRowToUser,
  toPublicUser,
  parseUserRole,
  parseKycStatus,
  InvalidEnumValueError,
  UserRow,
} from "../src/models/user";

const baseRow: UserRow = {
  id: "usr-uuid-1",
  email: "dev@movo.test",
  phone: "+5493510000000",
  first_name: "Tomas",
  last_name: "Olmos",
  password_hash: "hashed",
  dni: "12345678",
  phone_verified: false,
  photo_url: null,
  kyc_status_identity: "pending",
  last_kyc_verification_identity_id: null,
  kyc_status_license: "not_started",
  last_kyc_verification_license_id: null,
  is_banned: false,
  banned_until: null,
  created_at: new Date("2026-07-28T00:00:00Z"),
  updated_at: new Date("2026-07-28T00:00:00Z"),
};

describe("parseUserRole", () => {
  it.each([
    ["sender", UserRole.SENDER],
    ["carrier", UserRole.CARRIER],
    ["admin", UserRole.ADMIN],
  ])("acepta el literal alineado '%s'", (dbValue, role) => {
    expect(parseUserRole(dbValue)).toBe(role);
  });

  // Postgres garantiza que la columna esté dentro de su propio enum, pero no
  // que ese enum siga alineado con @movo/shared: un ALTER TYPE ... ADD VALUE
  // sin actualizar el dominio entra por acá.
  it("lanza InvalidEnumValueError ante un rol que no existe en @movo/shared", () => {
    expect(() => parseUserRole("moderator")).toThrow(InvalidEnumValueError);
  });

  it("el error identifica la columna y el valor que la DB trajo", () => {
    try {
      parseUserRole("moderator");
      expect.unreachable("parseUserRole debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEnumValueError);
      expect((error as InvalidEnumValueError).column).toBe("user_roles.role");
      expect((error as InvalidEnumValueError).value).toBe("moderator");
    }
  });

  it("rechaza el literal en español previo a MOVO-91", () => {
    expect(() => parseUserRole("emisor")).toThrow(InvalidEnumValueError);
  });
});

describe("parseKycStatus", () => {
  it.each([
    ["not_started", KycStatus.NOT_STARTED],
    ["pending", KycStatus.PENDING],
    ["approved", KycStatus.APPROVED],
    ["rejected", KycStatus.REJECTED],
    ["expired", KycStatus.EXPIRED],
  ])("acepta el literal alineado '%s'", (dbValue, status) => {
    expect(parseKycStatus(dbValue, "kyc_status_identity")).toBe(status);
  });

  it("rechaza el literal en mayúscula previo a MOVO-91", () => {
    expect(() => parseKycStatus("PENDING", "kyc_status_identity")).toThrow(
      InvalidEnumValueError
    );
  });

  it("el error distingue cuál de las dos columnas de KYC trajo el valor raro", () => {
    try {
      parseKycStatus("vencido", "kyc_status_license");
      expect.unreachable("parseKycStatus debería haber lanzado");
    } catch (error) {
      expect((error as InvalidEnumValueError).column).toBe("kyc_status_license");
      expect((error as InvalidEnumValueError).value).toBe("vencido");
    }
  });
});

describe("mapRowToUser", () => {
  it("arma el User de dominio a partir de una fila cruda + roles de DB (MOVO-91: mismo literal en DB y dominio)", () => {
    const user = mapRowToUser(baseRow, ["sender", "carrier"]);

    expect(user.id).toBe("usr-uuid-1");
    expect(user.firstName).toBe("Tomas");
    expect(user.kycStatusIdentity).toBe(KycStatus.PENDING);
    expect(user.kycStatusLicense).toBe(KycStatus.NOT_STARTED);
    expect(user.roles).toEqual([UserRole.SENDER, UserRole.CARRIER]);
  });

  it("propaga InvalidEnumValueError si la fila trae un valor desalineado", () => {
    expect(() => mapRowToUser({ ...baseRow, kyc_status_identity: "PENDING" }, ["sender"])).toThrow(
      InvalidEnumValueError
    );
  });
});

describe("toPublicUser", () => {
  it("no expone passwordHash", () => {
    const publicUser = toPublicUser(mapRowToUser(baseRow, ["sender"]));

    expect("passwordHash" in publicUser).toBe(false);
    expect(JSON.stringify(publicUser)).not.toContain("hashed");
  });

  it("conserva el resto de los campos del usuario", () => {
    const user = mapRowToUser(baseRow, ["sender"]);
    const publicUser = toPublicUser(user);

    expect(publicUser).toEqual({
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      dni: user.dni,
      phoneVerified: user.phoneVerified,
      photoUrl: user.photoUrl,
      kycStatusIdentity: user.kycStatusIdentity,
      lastKycVerificationIdentityId: user.lastKycVerificationIdentityId,
      kycStatusLicense: user.kycStatusLicense,
      lastKycVerificationLicenseId: user.lastKycVerificationLicenseId,
      isBanned: user.isBanned,
      bannedUntil: user.bannedUntil,
      roles: user.roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  });
});
