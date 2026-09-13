import { fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { ActiveShipmentSummary } from "../src/api/shipments-client";
import { ActiveShipmentCard } from "../components/home/active-shipment-card";

function makeShipment(overrides: Partial<ActiveShipmentSummary> = {}): ActiveShipmentSummary {
  return {
    id: "s1",
    status: "assigned",
    pickupDate: "2026-09-15",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Córdoba 1200, Córdoba",
    deliveryAddress: "San Martín 450, Córdoba",
    agreedPriceArs: 4500,
    counterparty: { name: "Lucía Gómez", initials: "LG" },
    isToday: false,
    pickupWindowExpired: false,
    ...overrides,
  };
}

describe("ActiveShipmentCard (MOVO-193)", () => {
  it("muestra la contraparte, el estado y el CTA cuando corresponde", async () => {
    const { getByText, getByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment()} role="sending" testID="card" />,
    );

    expect(getByText("Lucía Gómez")).toBeTruthy();
    expect(getByText("Asignado")).toBeTruthy();
    expect(getByTestId("card-cta")).toBeTruthy();
    expect(getByText("Generar retiro")).toBeTruthy();
  });

  it("sin CTA (assigned_unfunded) muestra el texto informativo, sin botón", async () => {
    const { queryByTestId, getByText } = await render(
      <ActiveShipmentCard shipment={makeShipment({ status: "assigned_unfunded" })} role="sending" testID="card" />,
    );

    expect(queryByTestId("card-cta")).toBeNull();
    expect(getByText("Los fondos se reservan antes del retiro.")).toBeTruthy();
  });

  it("muestra los badges 'Hoy' y 'Ventana vencida' según los flags del backend", async () => {
    const { getByText } = await render(
      <ActiveShipmentCard
        shipment={makeShipment({ isToday: true, pickupWindowExpired: true })}
        role="sending"
        testID="card"
      />,
    );

    expect(getByText("Hoy")).toBeTruthy();
    expect(getByText("Ventana vencida")).toBeTruthy();
  });

  it("tocar el CTA muestra un aviso 'Muy pronto' en vez de navegar (MOVO-159/160 sin pantalla todavía)", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    const { getByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment({ status: "in_transit" })} role="receiving" testID="card" />,
    );

    await fireEvent.press(getByTestId("card-cta"));

    expect(alertSpy).toHaveBeenCalledWith("Muy pronto", expect.stringContaining("MOVO-160"));
    alertSpy.mockRestore();
  });
});
