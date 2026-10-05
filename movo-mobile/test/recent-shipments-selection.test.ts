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
    pickupDate: "2026-08-20",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    highDemand: null,
    agreedPriceArs: null,
    paymentMethod: null,
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

  it("AC2: cancelled y rejected_by_receiver (receptor) expiran a las 48h desde lastStatusChangedAt", () => {
    const _47_HOURS_AGO = new Date(NOW.getTime() - 47 * 60 * 60 * 1000).toISOString();
    const _49_HOURS_AGO = new Date(NOW.getTime() - 49 * 60 * 60 * 1000).toISOString();

    const cancelledNew = createShipment("can-new", _47_HOURS_AGO, ShipmentStatus.CANCELLED);
    const cancelledOld = createShipment("can-old", _49_HOURS_AGO, ShipmentStatus.CANCELLED);
    
    // rejected viejo (para el receptor es historial que expira, para el emisor no expira de la vista en este filtro, 
    // pero si pierde el action level 1 si ya pasó la re-designación, bajando a nivel 2. 
    // Aquí testeamos como receptor para ver si se oculta)
    const rejectedOld = createShipment("rej-old", _49_HOURS_AGO, ShipmentStatus.REJECTED_BY_RECEIVER);

    const items = [cancelledNew, cancelledOld, rejectedOld];
    const result = selectRecentShipments(items, USER_2, { now: NOW });

    expect(result.map((s) => s.id)).toEqual(["can-new"]);
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
