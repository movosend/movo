import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentSummary } from "../src/api/shipments-client";
import { selectRecentShipments } from "../src/lib/recent-shipments-selection";

function createShipment(
  id: string,
  createdAt: string,
  status: ShipmentStatus,
  overrides: Partial<ShipmentSummary> = {},
): ShipmentSummary {
  return {
    id,
    senderId: "user-1",
    receiverId: "user-2",
    carrierId: null,
    packageType: "standard_package",
    weightKg: 2,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-10-02",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    highDemand: null,
    agreedPriceArs: null,
    paymentMethod: "card",
    status,
    lastStatusChangedAt: createdAt,
    deliveredAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe("selectRecentShipments (MOVO-184)", () => {
  const USER_1 = "user-1";
  const USER_2 = "user-2";
  const NOW = new Date("2026-10-02T10:00:00.000Z");

  it("AC1: Ordena priorizando acción (1) > ongoing (2) > historial (3)", () => {
    // 3. Historial
    const past = createShipment("past", "2026-10-02T09:00:00.000Z", ShipmentStatus.COMPLETED);
    // 2. Ongoing sin acción
    const ongoing = createShipment("ongoing", "2026-10-02T08:00:00.000Z", ShipmentStatus.IN_TRANSIT);
    // 1. Requiere acción: es receptor en AWAITING_RECEIVER_CONFIRMATION
    const action = createShipment("action", "2026-10-02T07:00:00.000Z", ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);

    // Nótese que por createdAt, "past" es el más nuevo (09:00) y "action" el más viejo (07:00).
    const items = [past, ongoing, action];

    // user-2 es el receptor, por lo que para user-2 "action" requiere acción.
    const result = selectRecentShipments(items, USER_2, { now: NOW, limit: 3 });

    expect(result.map((s) => s.id)).toEqual(["action", "ongoing", "past"]);
  });

  it("AC1: Dentro del mismo nivel de prioridad, ordena por createdAt desc", () => {
    const ongoing1 = createShipment("on-old", "2026-10-02T08:00:00.000Z", ShipmentStatus.IN_TRANSIT);
    const ongoing2 = createShipment("on-new", "2026-10-02T09:00:00.000Z", ShipmentStatus.PUBLISHED);

    const result = selectRecentShipments([ongoing1, ongoing2], USER_1, { now: NOW, limit: 2 });

    expect(result.map((s) => s.id)).toEqual(["on-new", "on-old"]);
  });

  it("AC1: rejected_by_receiver cae en nivel 1 para el emisor (si no expiró el plazo) y nivel 3 para el receptor", () => {
    const rejected = createShipment("rej", "2026-10-02T09:00:00.000Z", ShipmentStatus.REJECTED_BY_RECEIVER, {
      receiverRedesignationDeadline: "2026-10-03T09:00:00.000Z", // Plazo vivo
    });
    const ongoing = createShipment("ong", "2026-10-02T08:00:00.000Z", ShipmentStatus.IN_TRANSIT);

    // Para el emisor (user-1): rejected tiene acción, así que le gana a ongoing
    const resultEmisor = selectRecentShipments([ongoing, rejected], USER_1, { now: NOW });
    expect(resultEmisor.map((s) => s.id)).toEqual(["rej", "ong"]);

    // Para el receptor (user-2): rejected es past, ongoing es ongoing (gana ongoing)
    const resultReceptor = selectRecentShipments([ongoing, rejected], USER_2, { now: NOW });
    expect(resultReceptor.map((s) => s.id)).toEqual(["ong", "rej"]);
  });

  describe("AC2: se ve el día en que se cerró o venció y el siguiente (días calendario)", () => {
    // Hora argentina (UTC-3): la regla es por día del calendario argentino, no por 48 h corridas ni por el
    // calendario del dispositivo (CI corre en UTC).
    const argentina = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour + 3, 0));
    const LOCAL_NOW = argentina(2, 10); // vie 02/10 10:00
    const at = (day: number, hour: number) => argentina(day, hour).toISOString();

    it("un cancelado se ve el día del cierre y el siguiente, aunque pasen más de 24 h", () => {
      const today = createShipment("today", at(2, 1), ShipmentStatus.CANCELLED);
      const yesterdayEarly = createShipment("yesterday", at(1, 0), ShipmentStatus.CANCELLED);
      const twoDaysAgoLate = createShipment("two-days", at(0, 23), ShipmentStatus.CANCELLED);

      const result = selectRecentShipments([today, yesterdayEarly, twoDaysAgoLate], USER_2, { now: LOCAL_NOW });

      expect(result.map((s) => s.id).sort()).toEqual(["today", "yesterday"]);
    });

    it("rejected_by_receiver (visto por el receptor) sigue la misma regla", () => {
      const rejectedOld = createShipment("rej-old", at(0, 12), ShipmentStatus.REJECTED_BY_RECEIVER);

      expect(selectRecentShipments([rejectedOld], USER_2, { now: LOCAL_NOW })).toEqual([]);
    });

    it("un envío abierto sin retirar con el retiro antes de ayer sale de Inicio (ventana vencida)", () => {
      const assignedOld = createShipment("assigned-old", at(1, 9), ShipmentStatus.ASSIGNED, {
        pickupDate: "2026-09-30",
      });
      const assignedYesterday = createShipment("assigned-yesterday", at(1, 9), ShipmentStatus.ASSIGNED, {
        pickupDate: "2026-10-01",
      });

      const result = selectRecentShipments([assignedOld, assignedYesterday], USER_1, { now: LOCAL_NOW });

      expect(result.map((s) => s.id)).toEqual(["assigned-yesterday"]);
    });

    it("un envío vencido que todavía pide una acción se queda", () => {
      const rejected = createShipment("rej", at(1, 9), ShipmentStatus.REJECTED_BY_RECEIVER, {
        pickupDate: "2026-09-25",
        receiverRedesignationDeadline: at(3, 9), // plazo vivo para el emisor
      });

      expect(selectRecentShipments([rejected], USER_1, { now: LOCAL_NOW }).map((s) => s.id)).toEqual(["rej"]);
    });

    it("in_transit no vence por la fecha de retiro (ya se retiró)", () => {
      const inTransit = createShipment("transit", at(1, 9), ShipmentStatus.IN_TRANSIT, { pickupDate: "2026-09-20" });

      expect(selectRecentShipments([inTransit], USER_1, { now: LOCAL_NOW }).map((s) => s.id)).toEqual(["transit"]);
    });
  });

  it("AC2: delivered y completed no expiran nunca", () => {
    const _1_YEAR_AGO = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    
    const delivered = createShipment("del", _1_YEAR_AGO, ShipmentStatus.DELIVERED);
    const completed = createShipment("com", _1_YEAR_AGO, ShipmentStatus.COMPLETED);

    const result = selectRecentShipments([delivered, completed], USER_1, { now: NOW });

    expect(result.length).toBe(2);
  });
  it("AC1: un publicado sin ofertas por vencer (aviso informativo) no desplaza a un envío en curso", () => {
    const expiring = createShipment("exp", "2026-10-02T07:00:00.000Z", ShipmentStatus.PUBLISHED, {
      pickupDate: "2026-10-02",
      pendingOffersCount: 0,
    });
    const inTransit = createShipment("transit", "2026-10-02T09:00:00.000Z", ShipmentStatus.IN_TRANSIT);

    const result = selectRecentShipments([expiring, inTransit], USER_1, { now: NOW });

    expect(result.map((s) => s.id)).toEqual(["transit", "exp"]);
  });
});
