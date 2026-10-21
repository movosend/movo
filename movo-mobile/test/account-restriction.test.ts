import {
  formatSanctionDate,
  isActiveSuspension,
  notificationType,
  suspendedActionMessage,
} from "../src/lib/account-restriction";

// MOVO-300: copy y fechas de la suspensión.
describe("account-restriction", () => {
  const NOW = Date.parse("2026-10-20T12:00:00.000Z");

  it("formatSanctionDate usa el horario argentino (UTC-3)", () => {
    expect(formatSanctionDate("2026-10-26T02:00:00.000Z")).toBe("25/10");
    expect(formatSanctionDate("2026-10-26T03:00:00.000Z")).toBe("26/10");
    expect(formatSanctionDate("2026-01-05T15:00:00.000Z")).toBe("05/01");
  });

  it("isActiveSuspension: vigente, indefinida, vencida (aunque el barrido no la cerró) e inhabilitación", () => {
    expect(
      isActiveSuspension(
        { type: "suspension", reason: "x", endsAt: "2026-10-21T00:00:00.000Z" },
        NOW,
      ),
    ).toBe(true);
    expect(
      isActiveSuspension(
        { type: "suspension", reason: "x", endsAt: null },
        NOW,
      ),
    ).toBe(true);
    expect(
      isActiveSuspension(
        { type: "suspension", reason: "x", endsAt: "2026-10-20T11:59:59.000Z" },
        NOW,
      ),
    ).toBe(false);
    expect(
      isActiveSuspension({ type: "disable", reason: "x", endsAt: null }, NOW),
    ).toBe(false);
    expect(isActiveSuspension(null, NOW)).toBe(false);
  });

  it("suspendedActionMessage incluye el plazo solo si la suspensión tiene fin", () => {
    expect(
      suspendedActionMessage("offer", {
        type: "suspension",
        reason: "x",
        endsAt: "2026-10-26T02:00:00.000Z",
      }),
    ).toBe(
      "No podés hacer ofertas mientras tu cuenta esté suspendida (hasta el 25/10).",
    );
    expect(
      suspendedActionMessage("declareTrip", {
        type: "suspension",
        reason: "x",
        endsAt: null,
      }),
    ).toBe("No podés declarar viajes mientras tu cuenta esté suspendida.");
  });

  it("notificationType lee data.type o devuelve null", () => {
    expect(notificationType({ type: "account_suspended" })).toBe(
      "account_suspended",
    );
    expect(notificationType({ type: "" })).toBeNull();
    expect(notificationType(null)).toBeNull();
  });
});
