import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { createSanctionEffectsService, SanctionEffectsDeps } from "../src/modules/admin-internal/sanction-effects.service";
import { ShipmentConcurrentModificationError } from "../src/repositories/shipment-repository";

/** Unitario con dobles: los casos de error no se pueden provocar contra la base real. */
function build(overrides: Partial<SanctionEffectsDeps> = {}, shipmentIds: string[] = [randomUUID()]) {
  const userId = randomUUID();
  const db = {
    shipment: {
      // El listado de envíos en curso selecciona `senderId`; el de retirables, solo `id`.
      findMany: vi
        .fn()
        .mockImplementation(async (args: { select: Record<string, boolean> }) =>
          args.select.senderId ? [] : shipmentIds.map((id) => ({ id }))
        ),
    },
    offer: { findMany: vi.fn().mockResolvedValue([]) },
    trip: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const deps = {
    db,
    redis: { set: vi.fn().mockResolvedValue("OK"), del: vi.fn().mockResolvedValue(1) },
    offerRepository: { withdraw: vi.fn() },
    tripRepository: { stopRecurrenceForCarrier: vi.fn().mockResolvedValue([]), cancel: vi.fn() },
    cancelShipment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SanctionEffectsDeps;
  return { userId, deps, service: createSanctionEffectsService(deps) };
}

describe("sanction-effects (MOVO-297)", () => {
  it("un error real al cancelar un envío queda en `failures` y no corta al resto", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const cancelShipment = vi.fn().mockRejectedValueOnce(new Error("db caída")).mockResolvedValueOnce(undefined);
    const { userId, service } = build({ cancelShipment }, [a, b]);

    const result = await service.withdrawOpenActivity(userId);

    expect(result.failures).toEqual([{ kind: "shipment", id: a }]);
    expect(result.cancelledShipmentIds).toEqual([b]);
  });

  it("perder una carrera con otro flujo se saltea sin contarlo como fallo", async () => {
    const id = randomUUID();
    const cancelShipment = vi.fn().mockRejectedValue(new ShipmentConcurrentModificationError(id));
    const { userId, service } = build({ cancelShipment }, [id]);

    const result = await service.withdrawOpenActivity(userId);

    expect(result.failures).toEqual([]);
    expect(result.cancelledShipmentIds).toEqual([]);
    expect(cancelShipment).toHaveBeenCalledWith(id, userId, "cuenta suspendida", expect.arrayContaining([ShipmentStatus.PUBLISHED]));
  });

  it("si falla cortar la recurrencia lo informa en `failures` con el usuario", async () => {
    const tripRepository = { stopRecurrenceForCarrier: vi.fn().mockRejectedValue(new Error("boom")), cancel: vi.fn() };
    const { userId, service } = build({ tripRepository } as unknown as Partial<SanctionEffectsDeps>, []);

    const result = await service.withdrawOpenActivity(userId);

    expect(result.failures).toEqual([{ kind: "series", id: userId }]);
  });

  it("si Redis falla al liberar la clave tras un push fallido, el endpoint no revienta", async () => {
    const userId = randomUUID();
    const inProgress = {
      id: randomUUID(),
      status: "assigned",
      senderId: userId,
      carrierId: randomUUID(),
      receiverId: null,
      pickupAddress: "a",
      deliveryAddress: "b",
    };
    const service = createSanctionEffectsService({
      db: {
        shipment: { findMany: vi.fn().mockResolvedValue([inProgress]) },
        offer: { findMany: vi.fn().mockResolvedValue([]) },
        trip: { findMany: vi.fn().mockResolvedValue([]) },
      },
      redis: { set: vi.fn().mockResolvedValue("OK"), del: vi.fn().mockRejectedValue(new Error("redis caído")) },
      offerRepository: { withdraw: vi.fn() },
      tripRepository: { stopRecurrenceForCarrier: vi.fn().mockResolvedValue([]), cancel: vi.fn() },
      cancelShipment: vi.fn(),
      notificationsClient: { sendPush: vi.fn().mockRejectedValue(new Error("users caído")) },
    } as unknown as SanctionEffectsDeps);

    const result = await service.withdrawOpenActivity(userId);

    expect(result.notifiedCounterpartyCount).toBe(0);
  });
});
