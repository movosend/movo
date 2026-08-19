import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import {
  formatEventTimestamp,
  formatPickupWindowLabel,
  formatShipmentPrice,
  receiverConfirmationStatus,
  shipmentActorLabel,
  shipmentEventTitle,
  shipmentLifecycleStage,
  shipmentStatusLabel,
  shipmentStatusTone,
  shortAddressLabel,
} from "../src/lib/shipment-format";

describe("shipmentStatusLabel", () => {
  it("traduce cada estado canónico a español", () => {
    expect(shipmentStatusLabel(ShipmentStatus.PUBLISHED)).toBe("Publicado");
    expect(shipmentStatusLabel(ShipmentStatus.IN_TRANSIT)).toBe("En camino");
    expect(shipmentStatusLabel(ShipmentStatus.DELIVERED)).toBe("Entregado");
  });
});

describe("shipmentStatusTone", () => {
  it("mapea delivered a success", () => {
    expect(shipmentStatusTone(ShipmentStatus.DELIVERED)).toBe("success");
  });

  it("mapea cancelled/rejected/disputed a danger", () => {
    expect(shipmentStatusTone(ShipmentStatus.CANCELLED)).toBe("danger");
    expect(shipmentStatusTone(ShipmentStatus.REJECTED_BY_RECEIVER)).toBe("danger");
    expect(shipmentStatusTone(ShipmentStatus.DISPUTED)).toBe("danger");
  });

  it("mapea in_transit/assigned a info", () => {
    expect(shipmentStatusTone(ShipmentStatus.ASSIGNED)).toBe("info");
    expect(shipmentStatusTone(ShipmentStatus.IN_TRANSIT)).toBe("info");
  });
});

describe("formatShipmentPrice", () => {
  it("usa el precio acordado si existe", () => {
    expect(formatShipmentPrice(5000, 4500)).toBe("$5.000");
  });

  it("cae al precio sugerido si todavía no hay acuerdo", () => {
    expect(formatShipmentPrice(null, 4500)).toBe("$4.500");
  });
});

describe("receiverConfirmationStatus", () => {
  it("mapea awaiting_receiver_confirmation a pending", () => {
    expect(receiverConfirmationStatus(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION)).toBe("pending");
  });

  it("mapea rejected_by_receiver a rejected", () => {
    expect(receiverConfirmationStatus(ShipmentStatus.REJECTED_BY_RECEIVER)).toBe("rejected");
  });

  it("mapea cualquier estado posterior a confirmed", () => {
    expect(receiverConfirmationStatus(ShipmentStatus.PUBLISHED)).toBe("confirmed");
    expect(receiverConfirmationStatus(ShipmentStatus.DELIVERED)).toBe("confirmed");
  });
});

describe("shipmentLifecycleStage", () => {
  it("agrupa entregado/cancelado/rechazado como pasados", () => {
    expect(shipmentLifecycleStage(ShipmentStatus.DELIVERED)).toBe("past");
    expect(shipmentLifecycleStage(ShipmentStatus.CANCELLED)).toBe("past");
    expect(shipmentLifecycleStage(ShipmentStatus.REJECTED_BY_RECEIVER)).toBe("past");
  });

  it("agrupa el resto, incluido disputado, como en curso", () => {
    expect(shipmentLifecycleStage(ShipmentStatus.PUBLISHED)).toBe("ongoing");
    expect(shipmentLifecycleStage(ShipmentStatus.IN_TRANSIT)).toBe("ongoing");
    expect(shipmentLifecycleStage(ShipmentStatus.DISPUTED)).toBe("ongoing");
  });
});

describe("shortAddressLabel", () => {
  it("recorta la dirección al primer segmento antes de la coma", () => {
    expect(shortAddressLabel("Av. Colón 1234, Córdoba")).toBe("Av. Colón 1234");
  });

  it("devuelve la dirección completa si no tiene coma", () => {
    expect(shortAddressLabel("Av. Colón 1234")).toBe("Av. Colón 1234");
  });
});

describe("formatPickupWindowLabel", () => {
  it("arma el rango horario legible", () => {
    expect(formatPickupWindowLabel("09:00", "12:00")).toBe("09:00 a 12:00");
  });
});

describe("shipmentEventTitle", () => {
  it("lee el evento inicial (`fromStatus` null) como la creación del envío", () => {
    expect(shipmentEventTitle(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, null)).toBe("Envío creado");
  });

  it("usa un título narrativo, distinto de la etiqueta de estado", () => {
    expect(shipmentEventTitle(ShipmentStatus.IN_TRANSIT, ShipmentStatus.ASSIGNED)).toBe(
      "El paquete salió en camino",
    );
    expect(shipmentEventTitle(ShipmentStatus.REJECTED_BY_RECEIVER, ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION)).toBe(
      "El receptor rechazó el envío",
    );
  });
});

describe("formatEventTimestamp", () => {
  it("formatea un ISO datetime válido", () => {
    expect(formatEventTimestamp("2026-08-15T13:00:00.000Z")).toBeTruthy();
  });

  it("devuelve null ante una fecha inválida en vez de 'Invalid Date'", () => {
    expect(formatEventTimestamp("no-es-una-fecha")).toBeNull();
  });
});

describe("shipmentActorLabel", () => {
  const parties = { senderId: "sender-1", receiverId: "receiver-1", carrierId: "carrier-1" };

  it("prioriza la primera persona sobre el rol", () => {
    expect(shipmentActorLabel("sender-1", parties, "sender-1")).toBe("Vos");
  });

  it("resuelve cada parte del envío a su rol", () => {
    expect(shipmentActorLabel("sender-1", parties, "otro")).toBe("El emisor");
    expect(shipmentActorLabel("receiver-1", parties, "otro")).toBe("El receptor");
    expect(shipmentActorLabel("carrier-1", parties, "otro")).toBe("El transportista");
  });

  it("no muestra actor en una transición sin persona detrás", () => {
    expect(shipmentActorLabel(null, parties, "sender-1")).toBeNull();
  });

  it("cae a 'Equipo Movo' para un actor ajeno a las tres partes (admin)", () => {
    expect(shipmentActorLabel("admin-9", parties, "sender-1")).toBe("Equipo Movo");
  });
});
