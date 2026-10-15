import { describe, expect, it } from "vitest";
import { ApiError } from "@movo/shared";
import { createConflictChecker } from "../src/modules/audit/conflict-of-interest";
import { createFakeShipmentsClient, createFakeUsersClient } from "./fake-clients";

const ctx = { requestId: "req-1" };
const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER = "bbbbbbbb-0000-0000-0000-000000000002";

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof ApiError ? error.code : String(error);
  }
}

function shipmentWith(overrides: Partial<{ senderId: string; carrierId: string | null; receiverId: string | null; formerReceiverIds: string[] }>) {
  return {
    shipmentId: "s-1",
    senderId: OTHER,
    carrierId: null,
    receiverId: OTHER,
    formerReceiverIds: [],
    ...overrides,
  };
}

describe("regla de conflicto de interés (MOVO-288)", () => {
  const checker = (shipments = createFakeShipmentsClient(), users = createFakeUsersClient()) =>
    createConflictChecker({ shipmentsClient: shipments, usersClient: users });

  it("un admin no actúa sobre su propio usuario", async () => {
    expect(await codeOf(checker().assertNoConflict(ADMIN, { type: "user", id: ADMIN }, ctx))).toBe("ADMIN_CONFLICT_OF_INTEREST");
  });

  it("ni sobre su propio rol", async () => {
    expect(await codeOf(checker().assertNoConflict(ADMIN, { type: "admin_role", id: ADMIN }, ctx))).toBe(
      "ADMIN_CONFLICT_OF_INTEREST",
    );
  });

  it("sobre otro usuario sí puede", async () => {
    expect(await codeOf(checker().assertNoConflict(ADMIN, { type: "user", id: OTHER }, ctx))).toBeUndefined();
  });

  it.each([
    ["emisor", { senderId: ADMIN }],
    ["transportista", { carrierId: ADMIN }],
    ["receptor", { receiverId: ADMIN }],
    ["receptor anterior", { formerReceiverIds: [ADMIN] }],
  ])("un envío del que es %s da 403", async (_role, overrides) => {
    const shipments = createFakeShipmentsClient({ shipments: { "s-1": shipmentWith(overrides) } });

    expect(await codeOf(checker(shipments).assertNoConflict(ADMIN, { type: "shipment", id: "s-1" }, ctx))).toBe(
      "ADMIN_CONFLICT_OF_INTEREST",
    );
  });

  it("un envío ajeno pasa", async () => {
    const shipments = createFakeShipmentsClient({ shipments: { "s-1": shipmentWith({}) } });

    expect(await codeOf(checker(shipments).assertNoConflict(ADMIN, { type: "shipment", id: "s-1" }, ctx))).toBeUndefined();
  });

  it("un envío inexistente da 404, no deja pasar", async () => {
    expect(await codeOf(checker().assertNoConflict(ADMIN, { type: "shipment", id: "s-x" }, ctx))).toBe("NOT_FOUND");
  });

  it("si svc-shipments no responde falla cerrado con 502", async () => {
    const shipments = createFakeShipmentsClient({ down: true });

    expect(await codeOf(checker(shipments).assertNoConflict(ADMIN, { type: "shipment", id: "s-1" }, ctx))).toBe(
      "SHIPMENTS_SERVICE_UNAVAILABLE",
    );
  });

  it("un reporte de chat que lo involucra da 403; uno ajeno pasa", async () => {
    const shipments = createFakeShipmentsClient({
      chatReports: {
        mine: { reportId: "mine", shipmentId: "s-1", reporterId: OTHER, partyIds: [OTHER, ADMIN] },
        other: { reportId: "other", shipmentId: "s-2", reporterId: OTHER, partyIds: [OTHER] },
      },
    });
    const c = checker(shipments);

    expect(await codeOf(c.assertNoConflict(ADMIN, { type: "chat_report", id: "mine" }, ctx))).toBe("ADMIN_CONFLICT_OF_INTEREST");
    expect(await codeOf(c.assertNoConflict(ADMIN, { type: "chat_report", id: "other" }, ctx))).toBeUndefined();
  });

  it("un reporte de usuario donde es el reportado o quien reportó da 403", async () => {
    const users = createFakeUsersClient({
      userReports: {
        reported: { reportId: "reported", reporterId: OTHER, reportedId: ADMIN },
        reporter: { reportId: "reporter", reporterId: ADMIN, reportedId: OTHER },
      },
    });
    const c = checker(createFakeShipmentsClient(), users);

    expect(await codeOf(c.assertNoConflict(ADMIN, { type: "user_report", id: "reported" }, ctx))).toBe("ADMIN_CONFLICT_OF_INTEREST");
    expect(await codeOf(c.assertNoConflict(ADMIN, { type: "user_report", id: "reporter" }, ctx))).toBe("ADMIN_CONFLICT_OF_INTEREST");
    expect(await codeOf(c.assertNoConflict(ADMIN, { type: "user_report", id: "nope" }, ctx))).toBe("NOT_FOUND");
  });

  it("si svc-users no responde falla cerrado con 502", async () => {
    const c = checker(createFakeShipmentsClient(), createFakeUsersClient({ down: true }));

    expect(await codeOf(c.assertNoConflict(ADMIN, { type: "user_report", id: "r" }, ctx))).toBe("USERS_SERVICE_UNAVAILABLE");
  });
});
