import { describe, it, expect } from "vitest";
import { UserRole, KycStatus } from "@movo/shared";
import {
  roleToDb,
  roleFromDb,
  kycStatusToDb,
  kycStatusFromDb,
  mapRowToUser,
  InvalidEnumValueError,
  UserRow,
} from "../src/models/user";

describe("mapeo de roles (UserRole <-> enum de DB en español)", () => {
  it.each([
    [UserRole.SENDER, "emisor"],
    [UserRole.CARRIER, "transportista"],
    [UserRole.ADMIN, "admin"],
  ])("%s <-> %s", (role, dbValue) => {
    expect(roleToDb(role)).toBe(dbValue);
    expect(roleFromDb(dbValue)).toBe(role);
  });

  it("lanza InvalidEnumValueError si el literal de DB no tiene mapeo conocido", () => {
    expect(() => roleFromDb("repartidor")).toThrow(InvalidEnumValueError);
  });

  it("el error identifica la columna y el valor que la DB trajo", () => {
    try {
      roleFromDb("repartidor");
      expect.unreachable("roleFromDb debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEnumValueError);
      expect((error as InvalidEnumValueError).column).toBe("user_roles.role");
      expect((error as InvalidEnumValueError).value).toBe("repartidor");
    }
  });
});

describe("mapeo de KycStatus (minúscula <-> enum de DB en mayúscula)", () => {
  it.each([
    [KycStatus.NOT_STARTED, "NOT_STARTED"],
    [KycStatus.PENDING, "PENDING"],
    [KycStatus.APPROVED, "APPROVED"],
    [KycStatus.REJECTED, "REJECTED"],
    [KycStatus.EXPIRED, "EXPIRED"],
  ])("%s <-> %s", (status, dbValue) => {
    expect(kycStatusToDb(status)).toBe(dbValue);
    expect(kycStatusFromDb(dbValue, "kyc_status_identity")).toBe(status);
  });

  it("lanza InvalidEnumValueError si el literal de DB no tiene mapeo conocido", () => {
    expect(() => kycStatusFromDb("not_started", "kyc_status_identity")).toThrow(
      InvalidEnumValueError
    );
  });

  it("el error distingue cuál de las dos columnas de KYC trajo el valor raro", () => {
    try {
      kycStatusFromDb("VENCIDO", "kyc_status_license");
      expect.unreachable("kycStatusFromDb debería haber lanzado");
    } catch (error) {
      expect((error as InvalidEnumValueError).column).toBe("kyc_status_license");
      expect((error as InvalidEnumValueError).value).toBe("VENCIDO");
    }
  });
});

describe("mapRowToUser", () => {
  it("arma el User de dominio a partir de una fila cruda + roles de DB", () => {
    const row: UserRow = {
      id: "usr-uuid-1",
      email: "dev@movo.test",
      phone: "+5493510000000",
      first_name: "Tomas",
      last_name: "Olmos",
      password_hash: "hashed",
      dni: "12345678",
      phone_verified: false,
      photo_url: null,
      kyc_status_identity: "PENDING",
      last_kyc_verification_identity_id: null,
      kyc_status_license: "NOT_STARTED",
      last_kyc_verification_license_id: null,
      is_banned: false,
      banned_until: null,
      created_at: new Date("2026-07-28T00:00:00Z"),
      updated_at: new Date("2026-07-28T00:00:00Z"),
    };

    const user = mapRowToUser(row, ["emisor", "transportista"]);

    expect(user.id).toBe("usr-uuid-1");
    expect(user.firstName).toBe("Tomas");
    expect(user.kycStatusIdentity).toBe(KycStatus.PENDING);
    expect(user.kycStatusLicense).toBe(KycStatus.NOT_STARTED);
    expect(user.roles).toEqual([UserRole.SENDER, UserRole.CARRIER]);
  });
});
