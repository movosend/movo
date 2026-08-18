import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import {
  formatShipmentPrice,
  receiverConfirmationStatus,
  shipmentStatusLabel,
  shipmentStatusTone,
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
