import { describe, it, expect, vi } from "vitest";
import { ApiError, KycStatus, UserRole } from "@movo/shared";
import { assertCarrierCanOperate, resolveCarrierEligibility } from "../src/utils/carrier-gate";
import { UsersClient } from "../src/adapters/users-client";
import { createFakePaymentsClient } from "./fake-payments-client";

const CARRIER_ID = "carrier-id";

function usersClientWith(kyc: { kycStatusIdentity: KycStatus; kycStatusLicense: KycStatus } | null): UsersClient {
  return {
    findPublicProfile: vi.fn(),
    findDeviceKey: vi.fn(),
    listBlockRelatedUserIds: vi.fn(),
    findKycStatus: vi.fn().mockResolvedValue(kyc),
  };
}

const approved = { kycStatusIdentity: KycStatus.APPROVED, kycStatusLicense: KycStatus.APPROVED };

describe("carrier-gate (MOVO-116, ADR-036)", () => {
  describe("assertCarrierCanOperate", () => {
    it("deja pasar con identidad, licencia y MP", async () => {
      const deps = { usersClient: usersClientWith(approved), paymentsClient: createFakePaymentsClient() };

      await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).resolves.toBeUndefined();
    });

    it("sin rol carrier: 403 CARRIER_NOT_VERIFIED sin ninguna llamada de red", async () => {
      const deps = { usersClient: usersClientWith(approved), paymentsClient: createFakePaymentsClient() };

      await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.SENDER])).rejects.toMatchObject({
        statusCode: 403,
        code: "CARRIER_NOT_VERIFIED",
      });
      expect(deps.usersClient.findKycStatus).not.toHaveBeenCalled();
      expect(deps.paymentsClient.getCarrierMpAccountStatus).not.toHaveBeenCalled();
    });

    it("sin identidad aprobada: CARRIER_NOT_VERIFIED aunque también falten los otros requisitos", async () => {
      const deps = {
        usersClient: usersClientWith({ kycStatusIdentity: KycStatus.REJECTED, kycStatusLicense: KycStatus.NOT_STARTED }),
        paymentsClient: createFakePaymentsClient([CARRIER_ID]),
      };

      const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);
      expect(error).toMatchObject({ statusCode: 403, code: "CARRIER_NOT_VERIFIED" });
      expect((error as ApiError).details).toBeUndefined();
    });

    it("usuario inexistente en svc-users: CARRIER_NOT_VERIFIED", async () => {
      const deps = { usersClient: usersClientWith(null), paymentsClient: createFakePaymentsClient() };

      await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).rejects.toMatchObject({
        code: "CARRIER_NOT_VERIFIED",
      });
    });

    it.each([
      [KycStatus.PENDING, [], "CARRIER_LICENSE_NOT_APPROVED", ["license"]],
      [KycStatus.APPROVED, [CARRIER_ID], "CARRIER_MP_ACCOUNT_NOT_LINKED", ["mp_account"]],
      [KycStatus.EXPIRED, [CARRIER_ID], "CARRIER_LICENSE_NOT_APPROVED", ["license", "mp_account"]],
    ])("licencia %s, MP desvinculado %j: %s con %j", async (license, unlinked, code, missing) => {
      const deps = {
        usersClient: usersClientWith({ kycStatusIdentity: KycStatus.APPROVED, kycStatusLicense: license }),
        paymentsClient: createFakePaymentsClient(unlinked),
      };

      const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ statusCode: 403, code, details: { missingRequirements: missing } });
      expect((error as ApiError).toJSON().error.details).toEqual({ missingRequirements: missing });
    });

    it("propaga el 502 de svc-users (falla cerrado)", async () => {
      const usersClient = usersClientWith(approved);
      (usersClient.findKycStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "caído"),
      );

      await expect(
        assertCarrierCanOperate({ usersClient, paymentsClient: createFakePaymentsClient() }, CARRIER_ID, [UserRole.CARRIER]),
      ).rejects.toMatchObject({ statusCode: 502, code: "USERS_SERVICE_UNAVAILABLE" });
    });
  });

  describe("resolveCarrierEligibility", () => {
    it("consulta los dos servicios en paralelo con el id del transportista", async () => {
      const deps = { usersClient: usersClientWith(approved), paymentsClient: createFakePaymentsClient() };

      expect(await resolveCarrierEligibility(deps, CARRIER_ID)).toEqual({
        identityApproved: true,
        missingRequirements: [],
      });
      expect(deps.usersClient.findKycStatus).toHaveBeenCalledWith(CARRIER_ID);
      expect(deps.paymentsClient.getCarrierMpAccountStatus).toHaveBeenCalledWith(CARRIER_ID);
    });
  });
});
