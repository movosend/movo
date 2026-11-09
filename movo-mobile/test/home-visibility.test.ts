import { isStaleActiveShipment, isTodayOrYesterday } from "../src/lib/home-visibility";

describe("home-visibility: el día en que pasó y el siguiente", () => {
  const NOW = new Date(2026, 10, 9, 14, 0); // lun 09/11 14:00, hora local

  it("isTodayOrYesterday cuenta días calendario, no 48 h", () => {
    expect(isTodayOrYesterday(new Date(2026, 10, 9, 0, 1), NOW)).toBe(true);
    expect(isTodayOrYesterday(new Date(2026, 10, 8, 0, 1), NOW)).toBe(true);
    expect(isTodayOrYesterday(new Date(2026, 10, 7, 23, 59), NOW)).toBe(false);
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
