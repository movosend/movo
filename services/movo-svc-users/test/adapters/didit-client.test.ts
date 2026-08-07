import { describe, it, expect } from "vitest";
import { KycStatus } from "@movo/shared";
import { createDiditClient, mapDiditStatusToKycStatus } from "../../src/adapters/didit-client";

describe("createDiditClient (factory, MOVO-72)", () => {
  it("DIDIT_MODE=mock (default) no exige credenciales", () => {
    expect(() => createDiditClient({ DIDIT_MODE: "mock" })).not.toThrow();
  });

  it("DIDIT_MODE=live sin credenciales falla rápido al arrancar", () => {
    expect(() => createDiditClient({ DIDIT_MODE: "live" })).toThrow(
      /DIDIT_API_KEY, DIDIT_WORKFLOW_ID_IDENTITY y DIDIT_WEBHOOK_SECRET/
    );
  });

  it("DIDIT_MODE=live con las 4 credenciales completas no falla", () => {
    expect(() =>
      createDiditClient({
        DIDIT_MODE: "live",
        DIDIT_API_KEY: "k",
        DIDIT_WORKFLOW_ID_IDENTITY: "w",
        DIDIT_WEBHOOK_SECRET: "s",
      })
    ).not.toThrow();
  });
});

describe("mapDiditStatusToKycStatus (MOVO-72)", () => {
  it("mapea los 3 estados terminales a KycStatus", () => {
    expect(mapDiditStatusToKycStatus("Approved")).toBe(KycStatus.APPROVED);
    expect(mapDiditStatusToKycStatus("Declined")).toBe(KycStatus.REJECTED);
    expect(mapDiditStatusToKycStatus("In Review")).toBe(KycStatus.MANUAL_REVIEW);
  });

  it("devuelve null para estados intermedios no terminales", () => {
    expect(mapDiditStatusToKycStatus("Not Started")).toBeNull();
    expect(mapDiditStatusToKycStatus("In Progress")).toBeNull();
    expect(mapDiditStatusToKycStatus("Awaiting User")).toBeNull();
    expect(mapDiditStatusToKycStatus("Resubmitted")).toBeNull();
  });

  it("devuelve null para estados sin mapeo confirmado todavía (Expired/Abandoned/Kyc Expired, ver Paso 7 del plan)", () => {
    expect(mapDiditStatusToKycStatus("Expired")).toBeNull();
    expect(mapDiditStatusToKycStatus("Abandoned")).toBeNull();
    expect(mapDiditStatusToKycStatus("Kyc Expired")).toBeNull();
  });

  it("devuelve null para un string desconocido/no documentado", () => {
    expect(mapDiditStatusToKycStatus("algo-que-didit-nunca-documento")).toBeNull();
  });
});
