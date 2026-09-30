import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentSummary } from "../src/api/shipments-client";
import {
  activeCountLabel,
  compareOngoing,
  groupHistoryByMonth,
  isExpiringWithoutOffers,
  ongoingListTitle,
  personIdsByFrequency,
  presentMyShipment,
  statusFilterOptions,
} from "../src/lib/my-shipments-format";
import { formatPickupDayLabel } from "../src/lib/shipment-format";

// Domingo 27/9/2026, 10:00 hora local del dispositivo.
const NOW = new Date(2026, 8, 27, 10, 0);

function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "s1",
    senderId: "me",
    receiverId: "ana",
    carrierId: null,
    packageType: "standard_package",
    weightKg: 2,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Don Bosco 4807, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Rivadavia 387, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-09-30",
    pickupTimeWindowStart: "09:00:00",
    pickupTimeWindowEnd: "12:00:00",
    suggestedPriceArs: 4500,
    highDemand: null,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.PUBLISHED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    pendingOffersCount: 0,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

const present = (s: ShipmentSummary, name?: string) =>
  presentMyShipment(s, "me", { counterpartName: name, now: NOW });

describe("formatPickupDayLabel sin mes (MOVO-257)", () => {
  it('devuelve "Hoy"/"Mañana" y el día corto del prototipo', () => {
    const now = new Date("2026-09-27T15:00:00.000Z");
    expect(formatPickupDayLabel("2026-09-27", now, { includeMonth: false })).toBe("Hoy");
    expect(formatPickupDayLabel("2026-09-28", now, { includeMonth: false })).toBe("Mañana");
    expect(formatPickupDayLabel("2026-09-30", now, { includeMonth: false })).toBe("mié 30");
    expect(formatPickupDayLabel("2026-09-30", now)).toBe("mié 30 sep");
  });
});

describe("presentMyShipment", () => {
  it("emisor: el título es el destino, el precio aprox. sin acuerdo y pactado con acuerdo", () => {
    const p = present(shipment());
    expect(p.role).toBe("sending");
    expect(p.title).toBe("Rivadavia 387");
    expect(p.price).toBe("$4.500");
    expect(p.priceCaption).toBe("aprox.");
    expect(present(shipment({ agreedPriceArs: 5900 })).priceCaption).toBe("pactado");
  });

  it("receptor: el título es el origen", () => {
    expect(present(shipment({ senderId: "martin", receiverId: "me" })).title).toBe("Av. Don Bosco 4807");
  });

  it("receptor que tiene que aceptar: pill ACEPTÁ y franja con el nombre de quien envía", () => {
    const p = present(
      shipment({ senderId: "martin", receiverId: "me", status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION }),
      "Martín Sosa",
    );
    expect(p.pill).toEqual({ label: "ACEPTÁ", tone: "ink" });
    expect(p.strip).toEqual({ kind: "action", text: "Martín te manda un paquete. Aceptalo.", target: "detail" });
  });

  it("emisor esperando al receptor: texto gris, sin franja", () => {
    const p = present(shipment({ status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION }));
    expect(p.pill).toBeNull();
    expect(p.quietStatus).toBe("Esperando receptor");
    expect(p.strip).toBeNull();
  });

  it("emisor con ofertas: singular y plural", () => {
    expect(present(shipment({ pendingOffersCount: 1 })).pill?.label).toBe("1 OFERTA");
    const p = present(shipment({ pendingOffersCount: 3 }));
    expect(p.pill?.label).toBe("3 OFERTAS");
    expect(p.strip).toMatchObject({ kind: "action", target: "offers", text: "Tenés 3 ofertas. Elegí quién lo lleva." });
  });

  it("rechazado dentro del plazo: franja para elegir otro receptor", () => {
    const p = present(
      shipment({
        receiverId: "paul",
        status: ShipmentStatus.REJECTED_BY_RECEIVER,
        receiverRedesignationDeadline: new Date(2026, 8, 28, 18, 0).toISOString(),
      }),
      "Paul Díaz",
    );
    expect(p.stage).toBe("ongoing");
    expect(p.pill?.label).toBe("ELEGÍ RECEPTOR");
    expect(p.strip).toEqual({
      kind: "action",
      text: "Paul no aceptó el envío. Tenés hasta mañana 18:00 para elegir a otra persona.",
      target: "change_receiver",
    });
  });

  it("rechazado con el plazo vencido: sin acción", () => {
    const p = present(
      shipment({
        status: ShipmentStatus.REJECTED_BY_RECEIVER,
        receiverRedesignationDeadline: new Date(2026, 8, 26).toISOString(),
      }),
    );
    expect(p.strip).toBeNull();
    expect(p.quietStatus).toBe("Rechazado");
  });

  it("quien rechazó lo ve en el historial como RECHAZADO", () => {
    const p = present(
      shipment({
        senderId: "martin",
        receiverId: "me",
        status: ShipmentStatus.REJECTED_BY_RECEIVER,
        lastStatusChangedAt: "2026-09-24T15:00:00.000Z",
      }),
    );
    expect(p.stage).toBe("history");
    expect(p.pill).toEqual({ label: "RECHAZADO", tone: "danger" });
  });

  it("en camino: pill en vivo; asignado: texto gris con el nombre del estado", () => {
    expect(present(shipment({ status: ShipmentStatus.IN_TRANSIT })).pill).toEqual({ label: "EN CAMINO", tone: "live" });
    expect(present(shipment({ status: ShipmentStatus.ASSIGNED })).quietStatus).toBe("Asignado");
  });

  it("historial: día de cierre y pill de entregado o cancelado", () => {
    const delivered = present(
      shipment({ status: ShipmentStatus.COMPLETED, lastStatusChangedAt: "2026-09-24T15:00:00.000Z" }),
    );
    expect(delivered.stage).toBe("history");
    expect(delivered.dayLabel).toBe("jue 24");
    expect(delivered.pill).toEqual({ label: "ENTREGADO", tone: "success" });
    expect(present(shipment({ status: ShipmentStatus.CANCELLED })).pill?.label).toBe("CANCELADO");
  });
});

describe("envío por vencer sin ofertas", () => {
  it("avisa si el retiro empieza en menos de 24 h y no hay ofertas", () => {
    const p = present(shipment({ pickupDate: "2026-09-28", pickupTimeWindowStart: "09:00:00" }));
    expect(p.quietStatus).toBe("Publicado");
    expect(p.strip).toEqual({
      kind: "warning",
      text: "Nadie lo tomó todavía y el retiro es mañana. Si no llegan ofertas, se cancela solo.",
      target: "detail",
    });
  });

  it("no avisa con ofertas, con el retiro lejos, ni si el usuario es el receptor", () => {
    const soon = { pickupDate: "2026-09-28", pickupTimeWindowStart: "09:00:00" };
    expect(isExpiringWithoutOffers(shipment({ ...soon, pendingOffersCount: 2 }), "sending", NOW)).toBe(false);
    expect(isExpiringWithoutOffers(shipment({ pickupDate: "2026-09-29" }), "sending", NOW)).toBe(false);
    expect(isExpiringWithoutOffers(shipment({ ...soon, pendingOffersCount: null }), "receiving", NOW)).toBe(false);
  });

  it("no avisa si la ventana de retiro ya venció", () => {
    const expired = shipment({ pickupDate: "2026-09-27", pickupTimeWindowStart: "07:00:00", pickupTimeWindowEnd: "09:00:00" });
    expect(isExpiringWithoutOffers(expired, "sending", NOW)).toBe(false);
  });
});

describe("orden, agrupado y filtros", () => {
  it("En curso: primero lo que requiere acción, después por fecha de retiro", () => {
    const entries = [
      shipment({ id: "late", pickupDate: "2026-10-05" }),
      shipment({ id: "early", pickupDate: "2026-10-01" }),
      shipment({ id: "action", pickupDate: "2026-10-09", pendingOffersCount: 2 }),
    ].map((s) => ({ shipment: s, presentation: present(s) }));
    expect([...entries].sort(compareOngoing).map((e) => e.shipment.id)).toEqual(["action", "early", "late"]);
  });

  it("Historial: agrupa por mes de cierre y agrega el año si no es el actual", () => {
    const items = [
      shipment({ id: "aug", lastStatusChangedAt: "2026-08-10T15:00:00.000Z" }),
      shipment({ id: "sep", lastStatusChangedAt: "2026-09-24T15:00:00.000Z" }),
      shipment({ id: "old", lastStatusChangedAt: "2025-12-03T15:00:00.000Z" }),
    ].map((s) => ({ shipment: s }));
    const groups = groupHistoryByMonth(items, NOW);
    expect(groups.map((g) => g.month)).toEqual(["Septiembre", "Agosto", "Diciembre 2025"]);
  });

  it("Persona: la otra parte de cada envío, de la más frecuente a la menos, filtrable por rol", () => {
    const entries = [
      shipment({ id: "a", receiverId: "ana" }),
      shipment({ id: "b", receiverId: "ana" }),
      shipment({ id: "c", senderId: "martin", receiverId: "me" }),
    ].map((s) => ({ presentation: present(s) }));
    expect(personIdsByFrequency(entries, "all")).toEqual(["ana", "martin"]);
    expect(personIdsByFrequency(entries, "receiving")).toEqual(["martin"]);
  });

  it("Estado: solo las opciones presentes, con los nombres de las filas", () => {
    const entries = [
      shipment({ pendingOffersCount: 2 }),
      shipment({ status: ShipmentStatus.IN_TRANSIT }),
      shipment({ status: ShipmentStatus.IN_TRANSIT }),
    ].map((s) => ({ presentation: present(s) }));
    expect(statusFilterOptions(entries)).toEqual([
      { id: "offers", label: "Con ofertas" },
      { id: "in_transit", label: "En camino" },
    ]);
  });

  it("textos de conteo y título de la lista", () => {
    expect(activeCountLabel(1)).toBe("1 activo");
    expect(activeCountLabel(3)).toBe("3 activos");
    expect(ongoingListTitle(4, "all")).toBe("4 en curso");
    expect(ongoingListTitle(2, "sending")).toBe("2 que enviás");
    expect(ongoingListTitle(1, "receiving")).toBe("1 que recibís");
  });
});
