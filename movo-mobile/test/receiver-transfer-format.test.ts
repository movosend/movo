import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import {
  receiverTransferDetail,
  receiverTransferStatusPill,
  receiverTransferSteps,
  receiverTransferTitle,
  receiverTransferViewer,
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
    ).toBe("Se canceló porque empezó la entrega. Lo seguís recibiendo vos.");
    expect(receiverTransferDetail(transfer({ status: "cancelled", cancelReason: "requester" }), "sender", NOW)).toBe(
      "Lucía canceló la solicitud.",
    );
    expect(receiverTransferDetail(transfer(), "requester", NOW)).toMatch(/^Tiene hasta hoy .* para aceptar\.$/);
  });

  it("los pasos muestran la solicitud y, una vez resuelta, el resultado", () => {
    expect(receiverTransferSteps(transfer(), "requester")).toHaveLength(1);
    const steps = receiverTransferSteps(
      transfer({ status: "completed", resolvedAt: "2026-10-10T12:20:00.000Z" }),
      "new_receiver",
    );
    expect(steps.map((s) => s.text)).toEqual([
      "Lucía pidió que lo reciba Martín",
      "Aceptaste recibirlo",
      "Ahora el receptor sos vos",
    ]);
  });
});
