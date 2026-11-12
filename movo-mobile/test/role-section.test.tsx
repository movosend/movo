import { fireEvent, render } from "@testing-library/react-native";
import type { ActiveShipmentSummary } from "../src/api/shipments-client";
import * as Haptics from "expo-haptics";
import { RoleSection } from "../components/home/role-section";
import type { ActiveShipmentItem } from "../src/lib/active-shipment-format";

function makeShipment(id: string): ActiveShipmentSummary {
  return {
    id,
    status: "assigned",
    pickupDate: "2026-09-15",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Córdoba 1200, Córdoba",
    deliveryAddress: "San Martín 450, Córdoba",
    agreedPriceArs: 4500,
    counterparty: { name: "Lucía Gómez", initials: "LG" },
    isToday: false,
    pickupWindowExpired: false, tripId: null,
    transitAnomalyFlaggedAt: null,
  };
}

jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

const asSending = (shipments: ActiveShipmentSummary[]): ActiveShipmentItem[] =>
  shipments.map((shipment) => ({ shipment, role: "sending" }));

describe("RoleSection (MOVO-193 AC1/AC2)", () => {
  it("no se renderiza (ni el testID) sin envíos activos", async () => {
    const { queryByTestId } = await render(
      <RoleSection testID="sending" title="Estoy enviando" items={asSending([])} />,
    );

    expect(queryByTestId("sending")).toBeNull();
  });

  it("renderiza el título y una card por cada envío activo", async () => {
    const { getByTestId, getByText } = await render(
      <RoleSection
        testID="sending"
        title="Estoy enviando"
        items={asSending([makeShipment("s1"), makeShipment("s2")])}
      />,
    );

    expect(getByText("Estoy enviando")).toBeTruthy();
    expect(getByTestId("sending-card-s1")).toBeTruthy();
    expect(getByTestId("sending-card-s2")).toBeTruthy();
  });

  it("con un solo envío no hay carrusel ni contador", async () => {
    const { queryByTestId, getByTestId } = await render(
      <RoleSection testID="sending" title="Estoy enviando" items={asSending([makeShipment("s1")])} />,
    );
    expect(getByTestId("sending-card-s1")).toBeTruthy();
    expect(queryByTestId("sending-carousel")).toBeNull();
    expect(queryByTestId("sending-counter")).toBeNull();
  });

  it("con varios envíos van en un carrusel horizontal con contador, que avanza al deslizar", async () => {
    const { getByTestId } = await render(
      <RoleSection
        testID="sending"
        title="Estoy enviando"
        items={asSending([makeShipment("s1"), makeShipment("s2"), makeShipment("s3")])}
      />,
    );
    const carousel = getByTestId("sending-carousel");
    expect(carousel.props.horizontal).toBe(true);
    expect(getByTestId("sending-counter")).toHaveTextContent("1 de 3");

    await fireEvent(carousel, "layout", { nativeEvent: { layout: { width: 400, height: 300 } } });
    // Ancho de tarjeta: 400 - 2×24 - 18 - 10 = 324; paso = 334.
    // Mientras desliza: pasada la mitad de la tarjeta ya cuenta la siguiente, y vibra una vez por tarjeta.
    await fireEvent.scroll(carousel, { nativeEvent: { contentOffset: { x: 100, y: 0 } } });
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    await fireEvent.scroll(carousel, { nativeEvent: { contentOffset: { x: 200, y: 0 } } });
    expect(getByTestId("sending-counter")).toHaveTextContent("2 de 3");
    await fireEvent.scroll(carousel, { nativeEvent: { contentOffset: { x: 334, y: 0 } } });
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it("con showRole cada tarjeta dice de qué lado está el usuario", async () => {
    const { getByTestId } = await render(
      <RoleSection
        testID="shipments"
        title="Envíos en curso"
        showRole
        items={[
          { shipment: makeShipment("s1"), role: "sending" },
          { shipment: makeShipment("r1"), role: "receiving" },
        ]}
      />,
    );
    expect(getByTestId("shipments-card-s1-role")).toHaveTextContent("Enviás");
    expect(getByTestId("shipments-card-r1-role")).toHaveTextContent("Recibís");
  });
});
