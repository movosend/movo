import { fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { router } from "expo-router";
import type { ActiveShipmentSummary } from "../src/api/shipments-client";
import { ActiveShipmentCard } from "../components/home/active-shipment-card";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

function makeShipment(overrides: Partial<ActiveShipmentSummary> = {}): ActiveShipmentSummary {
  return {
    id: "s1",
    status: "assigned",
    pickupDate: "2026-01-15",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Córdoba 1200, Córdoba",
    deliveryAddress: "San Martín 450, Córdoba",
    agreedPriceArs: 4500,
    counterparty: { name: "Lucía Gómez", initials: "LG" },
    isToday: false,
    pickupWindowExpired: false, tripId: null,
    transitAnomalyFlaggedAt: null,
    ...overrides,
  };
}

describe("ActiveShipmentCard (MOVO-193)", () => {
  describe("MOVO-278: in_transit demorado", () => {
    it("muestra el pill 'Demorado' con la explicación, sin el halo pulsante", async () => {
      const { getByText, getByTestId, queryByTestId } = await render(
        <ActiveShipmentCard
          shipment={makeShipment({ status: "in_transit", transitAnomalyFlaggedAt: "2026-10-04T10:00:00.000Z" })}
          role="sending"
          testID="card"
        />,
      );

      // "En camino" sigue siendo el nombre del paso del stepper: el estado vive en el pill.
      expect(getByTestId("card-status-pill")).toHaveTextContent("Demorado");
      expect(getByText("La entrega está demorada. Si no se confirma pronto, vamos a abrir una disputa.")).toBeTruthy();
      expect(queryByTestId("active-shipment-pulsing-step")).toBeNull();
    });

    it("sin marca sigue 'En camino' con el halo pulsante", async () => {
      const { getByTestId } = await render(
        <ActiveShipmentCard shipment={makeShipment({ status: "in_transit" })} role="sending" testID="card" />,
      );

      expect(getByTestId("card-status-pill")).toHaveTextContent("En camino");
      expect(getByTestId("active-shipment-pulsing-step")).toBeTruthy();
    });
  });

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

  it("isToday mueve 'hoy' al subtítulo en vez de un chip aparte, y muestra el chip 'Ventana vencida'", async () => {
    const { getByText, queryByText } = await render(
      <ActiveShipmentCard
        shipment={makeShipment({ isToday: true, pickupWindowExpired: true, tripId: null })}
        role="sending"
        testID="card"
      />,
    );

    expect(getByText("Lucía Gómez retira hoy")).toBeTruthy();
    expect(queryByText("Hoy")).toBeNull();
    expect(getByText("Ventana vencida")).toBeTruthy();
  });

  it("el receptor ve la localidad del retiro, no la calle (MOVO-194 AC4)", async () => {
    const { getByText, queryByText } = await render(
      <ActiveShipmentCard
        shipment={makeShipment({
          status: "in_transit",
          pickupAddress: "Belgrano 99, X5152 Villa Carlos Paz, Córdoba, Argentina",
        })}
        role="receiving"
        testID="card"
      />,
    );

    expect(getByText("Villa Carlos Paz, Córdoba")).toBeTruthy();
    expect(queryByText("Belgrano 99")).toBeNull();
  });

  it("el receptor ve 'la zona del emisor' si la dirección de retiro no trae localidad", async () => {
    const { getByText } = await render(
      <ActiveShipmentCard
        shipment={makeShipment({ status: "in_transit", pickupAddress: "Belgrano 99" })}
        role="receiving"
        testID="card"
      />,
    );

    expect(getByText("la zona del emisor")).toBeTruthy();
  });

  it("el emisor sigue viendo la calle del retiro", async () => {
    const { getByText } = await render(
      <ActiveShipmentCard
        shipment={makeShipment({ status: "assigned", pickupAddress: "Belgrano 99, Córdoba" })}
        role="sending"
        testID="card"
      />,
    );

    expect(getByText("Belgrano 99")).toBeTruthy();
  });

  it("Generar retiro abre la pantalla del QR de retiro, la misma que el detalle del envío", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment({ status: "assigned" })} role="sending" testID="card" />,
    );

    await fireEvent.press(getByTestId("card-cta"));

    expect(router.push).toHaveBeenCalledWith("/(app)/shipments/s1/handshake");
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("Confirmar recepción abre el escaneo del QR de entrega", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment({ status: "in_transit" })} role="receiving" testID="card" />,
    );

    await fireEvent.press(getByTestId("card-cta"));

    expect(router.push).toHaveBeenCalledWith("/(app)/shipments/s1/handshake-scan");
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("emisor + in_transit muestra el CTA 'Ver en el mapa' y navega a tracking al presionarlo", async () => {
    const { getByText, getByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment({ status: "in_transit" })} role="sending" testID="card" />,
    );

    expect(getByTestId("card-cta")).toBeTruthy();
    expect(getByText("Ver en el mapa")).toBeTruthy();

    await fireEvent.press(getByTestId("card-cta"));
    expect(router.push).toHaveBeenCalledWith("/(app)/shipments/s1/tracking");
  });

  it("un envío demo navega con ?demo=true al presionar 'Ver en el mapa'", async () => {
    const { getByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment({ id: "demo-in-transit", status: "in_transit" })} role="sending" testID="card" />,
    );

    await fireEvent.press(getByTestId("card-cta"));
    expect(router.push).toHaveBeenCalledWith("/(app)/shipments/demo-in-transit/tracking?demo=true");
  });

  it("el nodo pulsante ('En camino' actual) no lleva elevation — en Android tapaba por completo el halo detrás", async () => {
    const { toJSON } = await render(
      <ActiveShipmentCard shipment={makeShipment({ status: "in_transit" })} role="sending" testID="card" />,
    );

    function findAll(node: any, predicate: (n: any) => boolean, acc: any[] = []): any[] {
      if (!node || typeof node !== "object") return acc;
      if (predicate(node)) acc.push(node);
      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) findAll(child, predicate, acc);
      return acc;
    }

    const flatStyle = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? (Object.assign({}, ...style.filter(Boolean).map(flatStyle)) as Record<string, unknown>)
        : ((style as Record<string, unknown>) ?? {});

    // El nodo "actual" opaco: círculo blanco de 38x38 con el ícono adentro.
    const currentNodes = findAll(toJSON(), (n) => {
      const s = flatStyle(n.props?.style);
      return s.backgroundColor === "#FFFFFF" && s.width === 38 && s.height === 38 && s.borderRadius === 999;
    });

    expect(currentNodes.length).toBeGreaterThan(0);
    for (const node of currentNodes) {
      expect(flatStyle(node.props.style).elevation).toBeUndefined();
    }
  });

  it("MOVO-284: sin chat no muestra el botón", async () => {
    const { queryByTestId } = await render(<ActiveShipmentCard shipment={makeShipment()} role="sending" testID="card" />);
    expect(queryByTestId("card-chat")).toBeNull();
  });

  it("MOVO-284: con chat muestra el botón con el contador y abre la conversación", async () => {
    const { getByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment()} role="sending" chat={{ unreadCount: 3 }} testID="card" />,
    );
    expect(getByTestId("card-chat-badge")).toHaveTextContent("3");
    await fireEvent.press(getByTestId("card-chat"));
    expect(router.push).toHaveBeenCalledWith("/(app)/shipments/s1/chat");
  });

  it("MOVO-284: con chat pero sin mensajes sin leer no muestra contador", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ActiveShipmentCard shipment={makeShipment()} role="receiving" chat={{ unreadCount: 0 }} testID="card" />,
    );
    expect(getByTestId("card-chat")).toBeTruthy();
    expect(queryByTestId("card-chat-badge")).toBeNull();
  });
});
