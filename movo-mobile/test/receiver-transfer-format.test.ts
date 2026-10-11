import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import {
  receiverTransferDetail,
  receiverTransferMeta,
  receiverTransferQuote,
  receiverTransferStatusPill,
  receiverTransferSteps,
  receiverTransferTitle,
  receiverTransferViewer,
  type ReceiverTransferViewer,
} from "../src/lib/receiver-transfer-format";

const NOW = new Date("2026-10-10T12:00:00.000Z");

function transfer(overrides: Partial<ReceiverTransferRequest> = {}): ReceiverTransferRequest {
  return {
    id: "tr-1",
    shipmentId: "s-1",
    requestedBy: "lucia",
    requesterName: "Lucía Gómez",
    newReceiverId: "martin",
    newReceiverName: "Martín López",
    reason: "De viaje",
    responseReason: null,
    status: "pending_new_receiver",
    cancelReason: null,
    newReceiverDeadline: "2026-10-10T18:00:00.000Z",
    createdAt: "2026-10-10T12:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("receiver-transfer-format (MOVO-275)", () => {
  it("resuelve quién mira", () => {
    const t = transfer();
    expect(receiverTransferViewer(t, "lucia", "juan")).toBe("requester");
    expect(receiverTransferViewer(t, "martin", "juan")).toBe("new_receiver");
    expect(receiverTransferViewer(t, "juan", "juan")).toBe("sender");
    expect(receiverTransferViewer(t, "diego", "juan")).toBe("other");
    expect(receiverTransferViewer(t, null, "juan")).toBe("other");
  });

  it("un solo título por solicitud, según quién mira y si se completó", () => {
    const pending = transfer();
    expect(receiverTransferTitle(pending, "requester")).toBe("Le pediste a Martín que lo reciba");
    expect(receiverTransferTitle(pending, "sender")).toBe("Lucía le pidió a Martín que lo reciba");

    const completed = transfer({ status: "completed", resolvedAt: "2026-10-10T12:20:00.000Z" });
    expect(receiverTransferTitle(completed, "requester")).toBe("Le pasaste la recepción a Martín");
    expect(receiverTransferTitle(completed, "new_receiver")).toBe("Lucía te pasó la recepción");
    expect(receiverTransferTitle(completed, "sender")).toBe("Lucía le pasó la recepción a Martín");
    expect(receiverTransferTitle(completed, "other")).toBe("Cambió quién recibe: ahora Martín");
  });

  it("pill por estado", () => {
    expect(receiverTransferStatusPill(transfer()).label).toBe("Esperando respuesta");
    expect(receiverTransferStatusPill(transfer({ status: "completed" })).tone).toBe("success");
    expect(receiverTransferStatusPill(transfer({ status: "rejected_by_new_receiver" })).label).toBe("No aceptó");
    expect(receiverTransferStatusPill(transfer({ status: "expired" })).label).toBe("Venció");
    expect(receiverTransferStatusPill(transfer({ status: "cancelled" })).label).toBe("Cancelada");
  });

  it("el detalle dice que el paquete sigue con quien lo pidió cuando no prosperó", () => {
    expect(receiverTransferDetail(transfer({ status: "rejected_by_new_receiver" }), "requester", NOW)).toBe(
      "Martín no aceptó. Lo seguís recibiendo vos.",
    );
    expect(receiverTransferDetail(transfer({ status: "expired" }), "sender", NOW)).toBe(
      "Martín no respondió a tiempo. Lo sigue recibiendo Lucía.",
    );
    expect(
      receiverTransferDetail(transfer({ status: "cancelled", cancelReason: "delivery_started" }), "requester", NOW),
    ).toBe("Se canceló: el transportista empezó la entrega. Lo seguís recibiendo vos.");
    expect(receiverTransferDetail(transfer({ status: "cancelled", cancelReason: "requester" }), "sender", NOW)).toBe(
      "Lucía canceló la solicitud y lo sigue recibiendo.",
    );
    expect(receiverTransferDetail(transfer(), "requester", NOW)).toMatch(
      /^Tiene hasta hoy .* para aceptar\. Podés cancelar la solicitud\.$/,
    );
    expect(receiverTransferDetail(transfer(), "sender", NOW)).toBe(
      "Solo informativo. Si Martín no acepta, lo sigue recibiendo Lucía.",
    );
  });

  /**
   * Matriz del prototipo (estado × quién mira). El backend ya filtra quién ve qué
   * (`listForShipment`): emisor y quien la pidió ven todas, el resto solo la completada, y
   * la persona invitada no tiene acceso al envío hasta aceptar. Acá se fija que cada
   * combinación visible tenga título y detalle propios.
   */
  const RESOLVED = "2026-10-10T12:20:00.000Z";
  const visible: Array<[string, Partial<ReceiverTransferRequest>, ReceiverTransferViewer, string, string | null]> = [
    ["pendiente", {}, "requester", "Le pediste a Martín que lo reciba", null],
    ["pendiente", {}, "sender", "Lucía le pidió a Martín que lo reciba", "Solo informativo. Si Martín no acepta, lo sigue recibiendo Lucía."],
    ["completada", { status: "completed", resolvedAt: RESOLVED }, "requester", "Le pasaste la recepción a Martín", "Seguís viendo el envío en modo lectura."],
    ["completada", { status: "completed", resolvedAt: RESOLVED }, "new_receiver", "Lucía te pasó la recepción", "Firmás la entrega con el transportista."],
    ["completada", { status: "completed", resolvedAt: RESOLVED }, "sender", "Lucía le pasó la recepción a Martín", "La dirección de entrega no cambia."],
    ["completada", { status: "completed", resolvedAt: RESOLVED }, "other", "Cambió quién recibe: ahora Martín", "La entrega la firma Martín. Misma dirección."],
    ["rechazada", { status: "rejected_by_new_receiver", resolvedAt: RESOLVED }, "requester", "Le pediste a Martín que lo reciba", "Martín no aceptó. Lo seguís recibiendo vos."],
    ["rechazada", { status: "rejected_by_new_receiver", resolvedAt: RESOLVED }, "sender", "Lucía le pidió a Martín que lo reciba", "Martín no aceptó. Lo sigue recibiendo Lucía."],
    ["vencida", { status: "expired", resolvedAt: RESOLVED }, "requester", "Le pediste a Martín que lo reciba", "Martín no respondió a tiempo. Lo seguís recibiendo vos."],
    ["vencida", { status: "expired", resolvedAt: RESOLVED }, "sender", "Lucía le pidió a Martín que lo reciba", "Martín no respondió a tiempo. Lo sigue recibiendo Lucía."],
    ["cancelada por Lucía", { status: "cancelled", cancelReason: "requester", resolvedAt: RESOLVED }, "requester", "Le pediste a Martín que lo reciba", "Cancelaste la solicitud. Lo seguís recibiendo vos."],
    ["cancelada por Lucía", { status: "cancelled", cancelReason: "requester", resolvedAt: RESOLVED }, "sender", "Lucía le pidió a Martín que lo reciba", "Lucía canceló la solicitud y lo sigue recibiendo."],
    ["cancelada por la entrega", { status: "cancelled", cancelReason: "delivery_started", resolvedAt: RESOLVED }, "requester", "Le pediste a Martín que lo reciba", "Se canceló: el transportista empezó la entrega. Lo seguís recibiendo vos."],
    ["cancelada por la entrega", { status: "cancelled", cancelReason: "delivery_started", resolvedAt: RESOLVED }, "sender", "Lucía le pidió a Martín que lo reciba", "Se canceló porque empezó la entrega. Lo sigue recibiendo Lucía."],
  ];

  it.each(visible)("%s · %s: título y detalle", (_label, overrides, viewer, title, detail) => {
    const t = transfer(overrides);
    expect(receiverTransferTitle(t, viewer)).toBe(title);
    if (detail !== null) expect(receiverTransferDetail(t, viewer, NOW)).toBe(detail);
  });

  it("la fecha del item dice cuándo se resolvió, salvo pendiente y completada", () => {
    expect(receiverTransferMeta(transfer())).not.toContain("·");
    expect(receiverTransferMeta(transfer({ status: "completed", resolvedAt: RESOLVED }))).not.toContain("·");
    expect(receiverTransferMeta(transfer({ status: "rejected_by_new_receiver", resolvedAt: RESOLVED }))).toMatch(
      / · Martín respondió \d{2}:\d{2}$/,
    );
    expect(receiverTransferMeta(transfer({ status: "expired", resolvedAt: RESOLVED }))).toMatch(/ · Venció /);
    expect(receiverTransferMeta(transfer({ status: "cancelled", resolvedAt: RESOLVED }))).toMatch(/ · Cancelada /);
  });

  it("el motivo es el del rechazo si no aceptó, y si no el de quien la pidió", () => {
    expect(receiverTransferQuote(transfer())).toBe("De viaje");
    expect(receiverTransferQuote(transfer({ status: "completed" }))).toBe("De viaje");
    expect(
      receiverTransferQuote(transfer({ status: "rejected_by_new_receiver", responseReason: "Ese día trabajo" })),
    ).toBe("Ese día trabajo");
    expect(receiverTransferQuote(transfer({ status: "expired" }))).toBeNull();
    expect(receiverTransferQuote(transfer({ status: "cancelled" }))).toBeNull();
  });

  it("los pasos de la completada terminan con lo que implica el cambio para quien mira", () => {
    expect(receiverTransferSteps(transfer(), "requester")).toHaveLength(1);
    const completed = transfer({ status: "completed", resolvedAt: RESOLVED });
    expect(receiverTransferSteps(completed, "new_receiver").map((s) => s.text)).toEqual([
      "Lucía te pidió que lo recibas",
      "Aceptaste",
      "Ahora el receptor sos vos. Firmás la entrega con el transportista.",
    ]);
    expect(receiverTransferSteps(completed, "requester").map((s) => s.text)).toEqual([
      "Le pediste a Martín que lo reciba",
      "Martín aceptó",
      "Ahora el receptor es Martín. Seguís viendo el envío en modo lectura.",
    ]);
    // Mismo día: solo la hora.
    expect(receiverTransferSteps(completed, "sender")[1].time).toMatch(/^\d{2}:\d{2}$/);
  });
});
