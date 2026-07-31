import { describe, it, expect } from "vitest";
import { UserRole, KycStatus } from "@movo/shared";
import { mapRowToUser, UserRow } from "../src/models/user";

describe("mapRowToUser", () => {
  it("arma el User de dominio a partir de una fila cruda + roles de DB (MOVO-91: mismo literal en DB y dominio)", () => {
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
      kyc_status_identity: "pending",
      last_kyc_verification_identity_id: null,
      kyc_status_license: "not_started",
      last_kyc_verification_license_id: null,
      is_banned: false,
      banned_until: null,
      created_at: new Date("2026-07-28T00:00:00Z"),
      updated_at: new Date("2026-07-28T00:00:00Z"),
    };

    const user = mapRowToUser(row, ["sender", "carrier"]);

    expect(user.id).toBe("usr-uuid-1");
    expect(user.firstName).toBe("Tomas");
    expect(user.kycStatusIdentity).toBe(KycStatus.PENDING);
    expect(user.kycStatusLicense).toBe(KycStatus.NOT_STARTED);
    expect(user.roles).toEqual([UserRole.SENDER, UserRole.CARRIER]);
  });
});
