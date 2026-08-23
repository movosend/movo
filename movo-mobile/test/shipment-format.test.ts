import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import {
  canCancelShipment,
  formatEventTimestamp,
  formatPickupWindowLabel,
  formatReceiverConfirmationDeadline,
  formatShipmentPrice,
  receiverConfirmationStatus,
  remainingLifecycleSteps,
  shipmentActorLabel,
  shipmentEventDetail,
  shipmentEventTitle,
  shipmentLifecycleStage,
  shipmentPendingStepLabel,
  shipmentStatusLabel,
  shipmentStatusTone,
  shortAddressLabel,
} from "../src/lib/shipment-format";

describe("shipmentStatusLabel", () => {
  it("traduce cada estado canónico a español, corto y sin repetir el sujeto", () => {
    expect(shipmentStatusLabel(ShipmentStatus.PUBLISHED)).toBe("Publicado");
    expect(shipmentStatusLabel(ShipmentStatus.IN_TRANSIT)).toBe("En camino");
    expect(shipmentStatusLabel(ShipmentStatus.DELIVERED)).toBe("Entregado");
    expect(shipmentStatusLabel(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION)).toBe("Esperando receptor");
    expect(shipmentStatusLabel(ShipmentStatus.REJECTED_BY_RECEIVER)).toBe("Rechazado");
    expect(shipmentStatusLabel(ShipmentStatus.ASSIGNMENT_PENDING)).toBe("Sin asignar");
    expect(shipmentStatusLabel(ShipmentStatus.ASSIGNED)).toBe("Asignado");
  });
});

describe("shipmentStatusTone", () => {
  it("mapea delivered a success", () => {
    expect(shipmentStatusTone(ShipmentStatus.DELIVERED)).toBe("success");
  });

  it("mapea cancelled/rejected (terminales fallidos) a danger", () => {
    expect(shipmentStatusTone(ShipmentStatus.CANCELLED)).toBe("danger");
    expect(shipmentStatusTone(ShipmentStatus.REJECTED_BY_RECEIVER)).toBe("danger");
  });

  it("mapea awaiting_receiver_confirmation/disputed (esperan una acción) a warning", () => {
    expect(shipmentStatusTone(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION)).toBe("warning");
    expect(shipmentStatusTone(ShipmentStatus.DISPUTED)).toBe("warning");
  });

  it("mapea assignment_pending/assigned/in_transit (progreso automático) a info", () => {
    expect(shipmentStatusTone(ShipmentStatus.ASSIGNMENT_PENDING)).toBe("info");
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

describe("canCancelShipment", () => {
  it("permite cancelar desde los 3 estados sin fondos confirmados", () => {
    expect(canCancelShipment(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION)).toBe(true);
    expect(canCancelShipment(ShipmentStatus.PUBLISHED)).toBe(true);
    expect(canCancelShipment(ShipmentStatus.ASSIGNMENT_PENDING)).toBe(true);
  });

  it("no permite cancelar desde assigned ni desde estados terminales", () => {
    expect(canCancelShipment(ShipmentStatus.ASSIGNED)).toBe(false);
    expect(canCancelShipment(ShipmentStatus.IN_TRANSIT)).toBe(false);
    expect(canCancelShipment(ShipmentStatus.DELIVERED)).toBe(false);
    expect(canCancelShipment(ShipmentStatus.CANCELLED)).toBe(false);
    expect(canCancelShipment(ShipmentStatus.REJECTED_BY_RECEIVER)).toBe(false);
    expect(canCancelShipment(ShipmentStatus.DISPUTED)).toBe(false);
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

  it("nombra la aceptación del receptor, que no tiene estado propio (es la transición a published)", () => {
    expect(
      shipmentEventTitle(ShipmentStatus.PUBLISHED, ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION),
    ).toBe("El receptor aceptó el envío");
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

describe("shipmentEventDetail", () => {
  it("aclara que aceptar publica el envío en el mismo paso", () => {
    expect(
      shipmentEventDetail(ShipmentStatus.PUBLISHED, ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION),
    ).toBe("Publicado para transportistas");
  });

  it("no agrega nada cuando el título ya dice todo", () => {
    expect(shipmentEventDetail(ShipmentStatus.DELIVERED, ShipmentStatus.IN_TRANSIT)).toBeNull();
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

describe("remainingLifecycleSteps", () => {
  it("devuelve los pasos posteriores al estado actual, en orden", () => {
    expect(remainingLifecycleSteps(ShipmentStatus.PUBLISHED)).toEqual([
      ShipmentStatus.ASSIGNMENT_PENDING,
      ShipmentStatus.ASSIGNED,
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.DELIVERED,
    ]);
  });

  it("no devuelve nada en el estado final del camino feliz", () => {
    expect(remainingLifecycleSteps(ShipmentStatus.DELIVERED)).toEqual([]);
  });

  it("no devuelve nada para un envío que salió del camino feliz", () => {
    expect(remainingLifecycleSteps(ShipmentStatus.CANCELLED)).toEqual([]);
    expect(remainingLifecycleSteps(ShipmentStatus.REJECTED_BY_RECEIVER)).toEqual([]);
    expect(remainingLifecycleSteps(ShipmentStatus.DISPUTED)).toEqual([]);
  });
});

describe("shipmentPendingStepLabel", () => {
  it("nombra el paso futuro sin usar el pasado de shipmentEventTitle", () => {
    expect(shipmentPendingStepLabel(ShipmentStatus.PUBLISHED)).toBe("Aceptación del receptor");
    expect(shipmentPendingStepLabel(ShipmentStatus.IN_TRANSIT)).toBe("Retiro del paquete");
    expect(shipmentPendingStepLabel(ShipmentStatus.DELIVERED)).toBe("Entrega al receptor");
  });
});

describe("formatReceiverConfirmationDeadline", () => {
  it("devuelve null si no hay deadline o es inválido", () => {
    expect(formatReceiverConfirmationDeadline(null)).toBeNull();
    expect(formatReceiverConfirmationDeadline(undefined)).toBeNull();
    expect(formatReceiverConfirmationDeadline("")).toBeNull();
    expect(formatReceiverConfirmationDeadline("fecha-invalida")).toBeNull();
  });

  it("devuelve null si el plazo ya venció", () => {
    const deadline = "2026-08-20T12:00:00.000Z";
    const now = new Date("2026-08-20T13:00:00.000Z");
    expect(formatReceiverConfirmationDeadline(deadline, now)).toBeNull();
  });

  it("formatea el plazo en plural para más de 1 hora", () => {
    const deadline = "2026-08-22T00:00:00.000Z";
    const now = new Date("2026-08-20T12:00:00.000Z"); // 36 horas
    expect(formatReceiverConfirmationDeadline(deadline, now)).toBe("Te quedan 36 h para confirmar");
  });

  it("formatea el plazo en singular para 1 hora", () => {
    const deadline = "2026-08-20T13:00:00.000Z";
    const now = new Date("2026-08-20T12:00:00.000Z"); // 1 hora
    expect(formatReceiverConfirmationDeadline(deadline, now)).toBe("Te queda 1 h para confirmar");
  });

  it("redondea hacia arriba fracciones de hora", () => {
    const deadline = "2026-08-20T12:30:00.000Z";
    const now = new Date("2026-08-20T12:00:00.000Z"); // 30 min -> 1 h
    expect(formatReceiverConfirmationDeadline(deadline, now)).toBe("Te queda 1 h para confirmar");
  });
});

