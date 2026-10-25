import { describe, it, expect, vi } from "vitest";
import { AccountStatus, ApiError, CarrierKycStatusResponse, KycStatus, UserRole } from "@movo/shared";
import { assertCarrierCanOperate, resolveCarrierEligibility } from "../src/utils/carrier-gate";
import { UsersClient } from "../src/adapters/users-client";
import { createFakePaymentsClient } from "./fake-payments-client";

const CARRIER_ID = "carrier-id";

function usersClientWith(kyc: CarrierKycStatusResponse | null): UsersClient {
  return {
    findPublicProfile: vi.fn(),
    findDeviceKey: vi.fn(),
    listBlockRelatedUserIds: vi.fn(),
    findKycStatus: vi.fn().mockResolvedValue(kyc),
  };
}

function disputesWith(hasOpenDispute: boolean | Error) {
  return {
    hasOpenDisputeAsCarrier: vi.fn(() =>
      hasOpenDispute instanceof Error ? Promise.reject(hasOpenDispute) : Promise.resolve(hasOpenDispute),
    ),
  };
}

const approved = { kycStatusIdentity: KycStatus.APPROVED, kycStatusLicense: KycStatus.APPROVED };

describe("carrier-gate (MOVO-116, DD-036)", () => {
  describe("assertCarrierCanOperate", () => {
    it("deja pasar con identidad, licencia y MP", async () => {
      const deps = { usersClient: usersClientWith(approved), paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) };

      await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).resolves.toBeUndefined();
    });

    it("sin rol carrier: 403 CARRIER_NOT_VERIFIED sin ninguna llamada de red", async () => {
      const deps = { usersClient: usersClientWith(approved), paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) };

      await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.SENDER])).rejects.toMatchObject({
        statusCode: 403,
        code: "CARRIER_NOT_VERIFIED",
      });
      expect(deps.usersClient.findKycStatus).not.toHaveBeenCalled();
      expect(deps.paymentsClient.getCarrierMpAccountStatus).not.toHaveBeenCalled();
      expect(deps.shipmentRepository.hasOpenDisputeAsCarrier).not.toHaveBeenCalled();
    });

    it("sin identidad aprobada: CARRIER_NOT_VERIFIED aunque también falten los otros requisitos", async () => {
      const deps = {
        usersClient: usersClientWith({ kycStatusIdentity: KycStatus.REJECTED, kycStatusLicense: KycStatus.NOT_STARTED }),
        paymentsClient: createFakePaymentsClient([CARRIER_ID]), shipmentRepository: disputesWith(false),
      };

      const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);
      expect(error).toMatchObject({ statusCode: 403, code: "CARRIER_NOT_VERIFIED" });
      expect((error as ApiError).details).toBeUndefined();
    });

    it("usuario inexistente en svc-users: CARRIER_NOT_VERIFIED", async () => {
      const deps = { usersClient: usersClientWith(null), paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) };

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
        paymentsClient: createFakePaymentsClient(unlinked), shipmentRepository: disputesWith(false),
      };

      const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ statusCode: 403, code, details: { missingRequirements: missing } });
      expect((error as ApiError).toJSON().error.details).toEqual({ missingRequirements: missing });
    });

    it.each([
      [KycStatus.APPROVED, [], ["no_open_dispute"]],
      [KycStatus.PENDING, [CARRIER_ID], ["no_open_dispute", "license", "mp_account"]],
    ])(
      "MOVO-278: con una disputa abierta (licencia %s, MP desvinculado %j) responde CARRIER_DISPUTE_OPEN con %j",
      async (license, unlinked, missing) => {
        const deps = {
          usersClient: usersClientWith({ kycStatusIdentity: KycStatus.APPROVED, kycStatusLicense: license }),
          paymentsClient: createFakePaymentsClient(unlinked),
          shipmentRepository: disputesWith(true),
        };

        const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);
        expect(error).toMatchObject({
          statusCode: 403,
          code: "CARRIER_DISPUTE_OPEN",
          details: { missingRequirements: missing },
        });
        expect(deps.shipmentRepository.hasOpenDisputeAsCarrier).toHaveBeenCalledWith(CARRIER_ID);
      },
    );

    it("MOVO-278: si la consulta de disputas falla, falla cerrado", async () => {
      const deps = {
        usersClient: usersClientWith(approved),
        paymentsClient: createFakePaymentsClient(),
        shipmentRepository: disputesWith(new Error("db caída")),
      };

      await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).rejects.toThrow("db caída");
    });

    describe("deuda vencida en la cuenta corriente (MOVO-313, DD-044)", () => {
      const withDebt = () =>
        createFakePaymentsClient([], {}, { overdueDebtUserIds: new Set([CARRIER_ID]) });

      it("con deuda vencida y todo lo demás en regla: 403 USER_DEBT_OVERDUE con el requisito en details", async () => {
        const deps = { usersClient: usersClientWith(approved), paymentsClient: withDebt(), shipmentRepository: disputesWith(false) };

        const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
          statusCode: 403,
          code: "USER_DEBT_OVERDUE",
          details: { missingRequirements: ["no_overdue_debt"] },
        });
        expect((error as ApiError).toJSON().error.details).toEqual({ missingRequirements: ["no_overdue_debt"] });
        expect(deps.paymentsClient.getUserDebtStatus).toHaveBeenCalledWith(CARRIER_ID);
      });

      it("sin deuda vencida: deja pasar", async () => {
        const deps = { usersClient: usersClientWith(approved), paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) };

        await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).resolves.toBeUndefined();
      });

      it("con otros requisitos faltando, la deuda va al final y el code es el del primero", async () => {
        const deps = {
          usersClient: usersClientWith({ kycStatusIdentity: KycStatus.APPROVED, kycStatusLicense: KycStatus.PENDING }),
          paymentsClient: createFakePaymentsClient([CARRIER_ID], {}, { overdueDebtUserIds: new Set([CARRIER_ID]) }),
          shipmentRepository: disputesWith(false),
        };

        const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);

        expect(error).toMatchObject({
          statusCode: 403,
          code: "CARRIER_LICENSE_NOT_APPROVED",
          details: { missingRequirements: ["license", "mp_account", "no_overdue_debt"] },
        });
      });

      it("con licencia o MP faltando, el mensaje también menciona la deuda (no se la descubre después)", async () => {
        const deps = {
          usersClient: usersClientWith({ kycStatusIdentity: KycStatus.APPROVED, kycStatusLicense: KycStatus.PENDING }),
          paymentsClient: withDebt(),
          shipmentRepository: disputesWith(false),
        };

        const error = (await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e)) as ApiError;

        expect(error.code).toBe("CARRIER_LICENSE_NOT_APPROVED");
        expect(error.message).toContain("licencia");
        expect(error.message).toContain("deuda vencida");
      });

      it("con una disputa abierta y deuda: la disputa va primero", async () => {
        const deps = { usersClient: usersClientWith(approved), paymentsClient: withDebt(), shipmentRepository: disputesWith(true) };

        const error = await assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER]).catch((e: ApiError) => e);

        expect(error).toMatchObject({
          code: "CARRIER_DISPUTE_OPEN",
          details: { missingRequirements: ["no_open_dispute", "no_overdue_debt"] },
        });
      });

      it("sin identidad aprobada: CARRIER_NOT_VERIFIED, la deuda no la pisa", async () => {
        const deps = {
          usersClient: usersClientWith({ kycStatusIdentity: KycStatus.REJECTED, kycStatusLicense: KycStatus.APPROVED }),
          paymentsClient: withDebt(),
          shipmentRepository: disputesWith(false),
        };

        await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).rejects.toMatchObject({
          code: "CARRIER_NOT_VERIFIED",
        });
      });

      it("sin rol carrier no consulta la deuda", async () => {
        const deps = { usersClient: usersClientWith(approved), paymentsClient: withDebt(), shipmentRepository: disputesWith(false) };

        await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.SENDER])).rejects.toMatchObject({
          code: "CARRIER_NOT_VERIFIED",
        });
        expect(deps.paymentsClient.getUserDebtStatus).not.toHaveBeenCalled();
      });

      it("si svc-payments no responde el saldo, falla cerrado con su 502", async () => {
        const paymentsClient = createFakePaymentsClient([], {
          getUserDebtStatus: vi.fn().mockRejectedValue(new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "caído")),
        });
        const deps = { usersClient: usersClientWith(approved), paymentsClient, shipmentRepository: disputesWith(false) };

        await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).rejects.toMatchObject({
          statusCode: 502,
          code: "PAYMENTS_SERVICE_UNAVAILABLE",
        });
      });

      it("al saldar la deuda el bloqueo se levanta en la siguiente consulta (sin cache)", async () => {
        const paymentsClient = withDebt();
        const deps = { usersClient: usersClientWith(approved), paymentsClient, shipmentRepository: disputesWith(false) };

        await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).rejects.toMatchObject({
          code: "USER_DEBT_OVERDUE",
        });

        paymentsClient.behavior.overdueDebtUserIds.delete(CARRIER_ID);

        await expect(assertCarrierCanOperate(deps, CARRIER_ID, [UserRole.CARRIER])).resolves.toBeUndefined();
        expect(paymentsClient.getUserDebtStatus).toHaveBeenCalledTimes(2);
      });
    });

    it("propaga el 502 de svc-users (falla cerrado)", async () => {
      const usersClient = usersClientWith(approved);
      (usersClient.findKycStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "caído"),
      );

      await expect(
        assertCarrierCanOperate({ usersClient, paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) }, CARRIER_ID, [UserRole.CARRIER]),
      ).rejects.toMatchObject({ statusCode: 502, code: "USERS_SERVICE_UNAVAILABLE" });
    });
  });

  describe("resolveCarrierEligibility", () => {
    it("consulta los dos servicios en paralelo con el id del transportista", async () => {
      const deps = { usersClient: usersClientWith(approved), paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) };

      expect(await resolveCarrierEligibility(deps, CARRIER_ID)).toEqual({
        identityApproved: true,
        missingRequirements: [],
        // svc-users anterior a MOVO-265: no informa el estado de la cuenta.
        account: undefined,
      });
      expect(deps.usersClient.findKycStatus).toHaveBeenCalledWith(CARRIER_ID);
      expect(deps.paymentsClient.getCarrierMpAccountStatus).toHaveBeenCalledWith(CARRIER_ID);
      // MOVO-313: la deuda se consulta junto con los demás, no después.
      expect(deps.paymentsClient.getUserDebtStatus).toHaveBeenCalledWith(CARRIER_ID);
    });

    it("MOVO-313: la deuda se consulta en paralelo, no espera a KYC ni a MP", async () => {
      const order: string[] = [];
      const usersClient = usersClientWith(approved);
      (usersClient.findKycStatus as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push("kyc:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("kyc:end");
        return approved;
      });
      const paymentsClient = createFakePaymentsClient([], {
        getUserDebtStatus: vi.fn(async () => {
          order.push("debt:start");
          return { overdue: false, balanceArs: 0, oldestUnpaidAt: null };
        }),
      });

      await resolveCarrierEligibility({ usersClient, paymentsClient, shipmentRepository: disputesWith(false) }, CARRIER_ID);

      // Si fuera secuencial, `debt:start` aparecería después de `kyc:end`.
      expect(order.indexOf("debt:start")).toBeLessThan(order.indexOf("kyc:end"));
    });

    it("MOVO-265: devuelve el estado de la cuenta, con la suspensión como Date, y null si no existe", async () => {
      const suspended = {
        ...approved,
        accountStatus: AccountStatus.ACTIVE,
        bannedUntil: "2030-01-01T00:00:00.000Z",
      };
      const withAccount = { usersClient: usersClientWith(suspended), paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) };
      const missing = { usersClient: usersClientWith(null), paymentsClient: createFakePaymentsClient(), shipmentRepository: disputesWith(false) };

      expect((await resolveCarrierEligibility(withAccount, CARRIER_ID)).account).toEqual({
        status: AccountStatus.ACTIVE,
        bannedUntil: new Date("2030-01-01T00:00:00.000Z"),
      });
      expect((await resolveCarrierEligibility(missing, CARRIER_ID)).account).toBeNull();
    });
  });
});
