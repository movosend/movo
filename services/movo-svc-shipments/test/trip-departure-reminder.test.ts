import { describe, it, expect, vi } from "vitest";
import { departureReminderWindow } from "../src/domain/trip-departure-reminder";
import { sendTripDepartureReminders, TripDepartureReminderDeps } from "../src/modules/trips/trip-departure-reminder";
import { createFakeTripRepository } from "./fake-trip-repository";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { DepartureReminderTrip } from "../src/repositories/trip-repository";

// 14/10/2026 20:00 en Argentina (UTC-3).
const EVENING = new Date("2026-10-14T23:00:00.000Z");

describe("departureReminderWindow (MOVO-240)", () => {
  it("antes de las 19:00 (hora argentina) no hay ventana", () => {
    expect(departureReminderWindow(new Date("2026-10-14T21:59:59.000Z"))).toBeNull();
  });

  it("desde las 19:00 cubre el día calendario de mañana, con lo declarado antes de hoy", () => {
    expect(departureReminderWindow(new Date("2026-10-14T22:00:00.000Z"))).toEqual({
      departureFrom: new Date("2026-10-15T03:00:00.000Z"),
      departureTo: new Date("2026-10-16T03:00:00.000Z"),
      // 00:00 del 14/10 en Argentina.
      createdBefore: new Date("2026-10-14T03:00:00.000Z"),
    });
  });

  it("a las 23:59 el corte sigue en el inicio de hoy en Argentina (ya es 15/10 en UTC)", () => {
    expect(departureReminderWindow(new Date("2026-10-15T02:59:00.000Z"))?.createdBefore).toEqual(
      new Date("2026-10-14T03:00:00.000Z")
    );
  });

  it("a las 23:30 (ya 02:30 UTC del día siguiente) sigue usando el día argentino", () => {
    expect(departureReminderWindow(new Date("2026-10-15T02:30:00.000Z"))?.departureFrom).toEqual(
      new Date("2026-10-15T03:00:00.000Z")
    );
  });
});

function trip(overrides: Partial<DepartureReminderTrip> = {}): DepartureReminderTrip {
  return {
    id: "trip-1",
    carrierId: "carrier-1",
    destinationAddress: "Bv. Oroño 100, Rosario",
    acceptedPackagesCount: 0,
    ...overrides,
  };
}

function setup(trips: DepartureReminderTrip[]) {
  const claimed = new Set<string>();
  const deps: TripDepartureReminderDeps = {
    tripRepository: createFakeTripRepository({
      findDeclaredForDepartureReminder: vi.fn().mockResolvedValue(trips),
    }),
    notificationsClient: createFakeNotificationsClient(),
    claimNotificationOnce: vi.fn(async (key: string) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
    releaseNotificationClaim: vi.fn(async (key: string) => {
      claimed.delete(key);
    }),
  };
  return deps;
}

describe("sendTripDepartureReminders (MOVO-240)", () => {
  it("antes de las 19:00 no consulta viajes ni avisa", async () => {
    const deps = setup([trip()]);
    expect(await sendTripDepartureReminders(deps, new Date("2026-10-14T20:00:00.000Z"))).toBe(0);
    expect(deps.tripRepository.findDeclaredForDepartureReminder).not.toHaveBeenCalled();
    expect(deps.notificationsClient.sendPush).not.toHaveBeenCalled();
  });

  it("pide los viajes de mañana declarados antes de hoy", async () => {
    const deps = setup([]);
    await sendTripDepartureReminders(deps, EVENING);
    expect(deps.tripRepository.findDeclaredForDepartureReminder).toHaveBeenCalledWith({
      departureFrom: new Date("2026-10-15T03:00:00.000Z"),
      departureTo: new Date("2026-10-16T03:00:00.000Z"),
      createdBefore: new Date("2026-10-14T03:00:00.000Z"),
      limit: 100,
    });
  });

  it("recorre todas las páginas: 100 viajes ya avisados no tapan al 101", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => trip({ id: `trip-${i}` }));
    const deps = setup([]);
    vi.mocked(deps.tripRepository.findDeclaredForDepartureReminder)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([trip({ id: "trip-100" })]);
    // La primera página ya se avisó en una vuelta anterior.
    vi.mocked(deps.claimNotificationOnce).mockImplementation(async (key) => key === "trip-departure-reminder:trip-100");

    expect(await sendTripDepartureReminders(deps, EVENING)).toBe(1);
    expect(deps.tripRepository.findDeclaredForDepartureReminder).toHaveBeenCalledTimes(2);
    expect(deps.tripRepository.findDeclaredForDepartureReminder).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterId: "trip-99" })
    );
    expect(deps.notificationsClient.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: "trip_reminder", tripId: "trip-100" } })
    );
  });

  it("con paquetes, avisa cuántos lleva y abre el feed del viaje", async () => {
    const deps = setup([trip({ acceptedPackagesCount: 2 })]);
    expect(await sendTripDepartureReminders(deps, EVENING)).toBe(1);
    expect(deps.notificationsClient.sendPush).toHaveBeenCalledWith({
      userId: "carrier-1",
      title: "Mañana salís de viaje",
      body: "Ya llevás 2 paquetes a Bv. Oroño 100. ¿Te entra uno más? Fijate qué envíos te quedan de paso.",
      category: "trips",
      data: { type: "trip_reminder", tripId: "trip-1" },
    });
  });

  it("sin paquetes, usa el copy de buscar envíos", async () => {
    const deps = setup([trip()]);
    await sendTripDepartureReminders(deps, EVENING);
    expect(deps.notificationsClient.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tu viaje es mañana" })
    );
  });

  it("una segunda vuelta del barrido no repite el aviso", async () => {
    const deps = setup([trip()]);
    await sendTripDepartureReminders(deps, EVENING);
    await sendTripDepartureReminders(deps, new Date(EVENING.getTime() + 15 * 60 * 1000));
    expect(deps.notificationsClient.sendPush).toHaveBeenCalledTimes(1);
  });

  it("un push fallido libera el claim y no corta a los demás viajes", async () => {
    const deps = setup([trip({ id: "trip-1" }), trip({ id: "trip-2", carrierId: "carrier-2" })]);
    vi.mocked(deps.notificationsClient.sendPush).mockRejectedValueOnce(new Error("svc-users caído"));

    expect(await sendTripDepartureReminders(deps, EVENING)).toBe(1);
    expect(deps.releaseNotificationClaim).toHaveBeenCalledWith("trip-departure-reminder:trip-1");

    // La próxima vuelta reintenta el que falló.
    await sendTripDepartureReminders(deps, EVENING);
    expect(deps.notificationsClient.sendPush).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: "carrier-1" })
    );
    expect(deps.notificationsClient.sendPush).toHaveBeenCalledTimes(3);
  });
});
