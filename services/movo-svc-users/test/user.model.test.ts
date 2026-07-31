import { describe, it, expect } from "vitest";
import { UserRole, KycStatus } from "@movo/shared";
import {
  roleToDb,
  roleFromDb,
  kycStatusToDb,
  kycStatusFromDb,
  mapRowToUser,
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

  it("lanza si el literal de DB no tiene mapeo conocido", () => {
    expect(() => roleFromDb("repartidor")).toThrow();
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
    expect(kycStatusFromDb(dbValue)).toBe(status);
  });

  it("lanza si el literal de DB no tiene mapeo conocido", () => {
    expect(() => kycStatusFromDb("not_started")).toThrow();
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
