import { describe, it, expect } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import {
  getInitials,
  isActiveShipmentPickupWindowExpired,
  isShipmentPickupToday,
  resolveActiveShipmentCounterpartyId,
} from "../src/domain/active-shipment";

describe("isShipmentPickupToday", () => {
  it("la fecha de retiro coincide con el día calendario argentino de 'now'", () => {
    const pickupDate = new Date("2026-09-03T00:00:00.000Z");
    const now = new Date("2026-09-03T12:00:00.000Z"); // 09:00 ARG del mismo día
    expect(isShipmentPickupToday(pickupDate, now)).toBe(true);
  });

  it("borde de medianoche: un minuto antes de las 00:00 ARG todavía es el día anterior", () => {
    const pickupDate = new Date("2026-09-03T00:00:00.000Z");
    const now = new Date("2026-09-03T02:59:00.000Z"); // 23:59 ARG del 2/9 -- en Argentina todavía no es 3/9
    expect(isShipmentPickupToday(pickupDate, now)).toBe(false);
  });

  it("borde de medianoche: justo al cruzar las 00:00 ARG ya es el día del retiro", () => {
    const pickupDate = new Date("2026-09-03T00:00:00.000Z");
    const now = new Date("2026-09-03T03:00:00.000Z"); // 00:00 ARG del 3/9
    expect(isShipmentPickupToday(pickupDate, now)).toBe(true);
  });

  it("una fecha de retiro distinta a hoy no matchea", () => {
    const pickupDate = new Date("2026-09-05T00:00:00.000Z");
    const now = new Date("2026-09-03T12:00:00.000Z");
    expect(isShipmentPickupToday(pickupDate, now)).toBe(false);
  });
});

describe("isActiveShipmentPickupWindowExpired", () => {
  const expiredPickupDate = new Date("2026-08-30T00:00:00.000Z");
  const futurePickupDate = new Date("2026-09-10T00:00:00.000Z");
  const pickupTimeWindowEnd = new Date("1970-01-01T22:00:00.000Z");
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("assigned con ventana ya vencida cuenta como vencida", () => {
    expect(isActiveShipmentPickupWindowExpired(ShipmentStatus.ASSIGNED, expiredPickupDate, pickupTimeWindowEnd, now)).toBe(
      true
    );
  });

  it("assigned_unfunded con ventana ya vencida también cuenta como vencida", () => {
    expect(
      isActiveShipmentPickupWindowExpired(ShipmentStatus.ASSIGNED_UNFUNDED, expiredPickupDate, pickupTimeWindowEnd, now)
    ).toBe(true);
  });

  it("assigned con ventana todavía vigente no cuenta como vencida", () => {
    expect(isActiveShipmentPickupWindowExpired(ShipmentStatus.ASSIGNED, futurePickupDate, pickupTimeWindowEnd, now)).toBe(
      false
    );
  });

  it("in_transit nunca cuenta como vencida, aunque la ventana ya haya pasado -- el paquete ya se retiró", () => {
    expect(
      isActiveShipmentPickupWindowExpired(ShipmentStatus.IN_TRANSIT, expiredPickupDate, pickupTimeWindowEnd, now)
    ).toBe(false);
  });
});

describe("resolveActiveShipmentCounterpartyId", () => {
  const base = {
    senderId: "11111111-1111-1111-1111-111111111111",
    receiverId: "22222222-2222-2222-2222-222222222222",
    carrierId: "33333333-3333-3333-3333-333333333333",
    status: ShipmentStatus.ASSIGNED,
  };

  it("sending: la contraparte es siempre el transportista asignado", () => {
    expect(resolveActiveShipmentCounterpartyId("sending", base)).toBe(base.carrierId);
  });

  it("receiving: la contraparte es siempre el transportista asignado", () => {
    expect(resolveActiveShipmentCounterpartyId("receiving", base)).toBe(base.carrierId);
  });

  it("transporting: antes de in_transit, la contraparte es el emisor (a quien hay que retirarle el paquete)", () => {
    expect(resolveActiveShipmentCounterpartyId("transporting", { ...base, status: ShipmentStatus.ASSIGNED_UNFUNDED })).toBe(
      base.senderId
    );
    expect(resolveActiveShipmentCounterpartyId("transporting", base)).toBe(base.senderId);
  });

  it("transporting: en in_transit, la contraparte pasa a ser el receptor (a quien hay que entregarle el paquete)", () => {
    expect(resolveActiveShipmentCounterpartyId("transporting", { ...base, status: ShipmentStatus.IN_TRANSIT })).toBe(
      base.receiverId
    );
  });

  it("sending/receiving sin carrierId (estado inconsistente) lanza en vez de devolver un id inválido", () => {
    expect(() => resolveActiveShipmentCounterpartyId("sending", { ...base, carrierId: null })).toThrow();
    expect(() => resolveActiveShipmentCounterpartyId("receiving", { ...base, carrierId: null })).toThrow();
  });
});

describe("getInitials", () => {
  it("primera letra del primer y del último término", () => {
    expect(getInitials("Juan Cruz Bordino")).toBe("JB");
  });

  it("un solo nombre usa solo su primera letra", () => {
    expect(getInitials("Alena")).toBe("A");
  });

  it("nombre vacío o ausente devuelve '?'", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials(null)).toBe("?");
    expect(getInitials(undefined)).toBe("?");
  });

  it("normaliza a mayúsculas", () => {
    expect(getInitials("lucas dalmagro")).toBe("LD");
  });
});
