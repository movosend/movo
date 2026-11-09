import { isStaleActiveShipment, isTodayOrYesterday } from "../src/lib/home-visibility";

describe("home-visibility: el día en que pasó y el siguiente", () => {
  const NOW = new Date("2026-11-09T14:00:00-03:00"); // lun 09/11 14:00, hora argentina

  it("isTodayOrYesterday cuenta días calendario argentinos, no 48 h ni el calendario del dispositivo", () => {
    expect(isTodayOrYesterday(new Date("2026-11-09T00:01:00-03:00"), NOW)).toBe(true);
    expect(isTodayOrYesterday(new Date("2026-11-08T00:01:00-03:00"), NOW)).toBe(true);
    expect(isTodayOrYesterday(new Date("2026-11-07T23:59:00-03:00"), NOW)).toBe(false);
    // 08/11 01:00 UTC todavía es el 07/11 en Argentina.
    expect(isTodayOrYesterday(new Date("2026-11-08T01:00:00Z"), NOW)).toBe(false);
  });

  it("el día de retiro se corta en hora argentina: a las 22 h del 09/11 en Argentina ya es el 10/11 en UTC", () => {
    const lateNight = new Date("2026-11-09T22:00:00-03:00");
    expect(isStaleActiveShipment({ pickupWindowExpired: true, pickupDate: "2026-11-08" }, lateNight)).toBe(false);
  });

  it("al emisor no se le oculta el que espera su pago; al receptor sí", () => {
    const unfunded = { pickupWindowExpired: true, pickupDate: "2026-11-01", status: "assigned_unfunded" };
    expect(isStaleActiveShipment(unfunded, NOW, "sender")).toBe(false);
    expect(isStaleActiveShipment(unfunded, NOW, "receiver")).toBe(true);
    expect(isStaleActiveShipment({ ...unfunded, status: "assigned" }, NOW, "sender")).toBe(true);
  });

  it("una card con la ventana vencida se ve el día del retiro y el siguiente", () => {
    expect(isStaleActiveShipment({ pickupWindowExpired: true, pickupDate: "2026-11-09" }, NOW)).toBe(false);
    expect(isStaleActiveShipment({ pickupWindowExpired: true, pickupDate: "2026-11-08" }, NOW)).toBe(false);
    expect(isStaleActiveShipment({ pickupWindowExpired: true, pickupDate: "2026-11-07" }, NOW)).toBe(true);
  });

  it("sin la ventana vencida (p.ej. in_transit) nunca sale, aunque el retiro sea viejo", () => {
    expect(isStaleActiveShipment({ pickupWindowExpired: false, pickupDate: "2026-10-25" }, NOW)).toBe(false);
  });
});
