import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { act, fireEvent, render } from "@testing-library/react-native";
import type { ConfirmHandshakeResult } from "../src/api/shipments-client";

const mockUseShipment = jest.fn<{ data: Record<string, unknown> | undefined }, []>(() => ({ data: undefined }));
const mockUseShipmentRoute = jest.fn<
  { data: { distanceMeters: number; durationSeconds: number; polyline: string } | undefined },
  []
>(() => ({ data: undefined }));
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
  useShipmentRoute: () => mockUseShipmentRoute(),
}));

const mockUsePublicProfile = jest.fn(() => ({ data: undefined }));
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => mockUsePublicProfile(),
}));

import { HandshakeConfirmationResult } from "../components/handshake/handshake-confirmation-result";

const baseResult: ConfirmHandshakeResult = {
  shipmentId: "shipment-1",
  stage: "pickup",
  previousStatus: ShipmentStatus.ASSIGNED,
  status: ShipmentStatus.IN_TRANSIT,
  distanceM: 12.7,
  confirmedAt: "2026-09-13T13:00:00.000Z",
};

const shipment = {
  id: "shipment-1abcdef42317",
  senderId: "sender-1",
  receiverId: "receiver-1",
  deliveryAddress: "Bulnes 1180, CABA",
};

describe("HandshakeConfirmationResult", () => {
  afterEach(() => jest.clearAllMocks());

  it("retiro: muestra el eyebrow y el título de retiro", async () => {
    const { getByText } = await render(<HandshakeConfirmationResult result={baseResult} />);

    expect(getByText(/Retiro confirmado/)).toBeTruthy();
    expect(getByText(/Lo tenés vos\./)).toBeTruthy();
  });

  it("retiro: personaliza el título con la dirección real de entrega", async () => {
    mockUseShipment.mockReturnValue({ data: shipment });

    const { getByText } = await render(<HandshakeConfirmationResult result={baseResult} />);

    expect(getByText(/Ahora, a Bulnes 1180\./)).toBeTruthy();
  });

  it("retiro: muestra ruta/ETA real cuando la ruta ya cargó", async () => {
    mockUseShipment.mockReturnValue({ data: shipment });
    mockUseShipmentRoute.mockReturnValue({ data: { distanceMeters: 3400, durationSeconds: 1500, polyline: "" } });

    const { getByText } = await render(<HandshakeConfirmationResult result={baseResult} />);

    expect(getByText("25 min · 3.4 km")).toBeTruthy();
  });

  it("retiro: sin ruta cargada todavía, no muestra la línea de ETA", async () => {
    mockUseShipment.mockReturnValue({ data: shipment });
    mockUseShipmentRoute.mockReturnValue({ data: undefined });

    const { queryByText } = await render(<HandshakeConfirmationResult result={baseResult} />);

    expect(queryByText(/km$/)).toBeNull();
  });

  it("entrega: muestra el eyebrow/título de entrega, sin fila de ruta", async () => {
    const deliveryResult: ConfirmHandshakeResult = { ...baseResult, stage: "delivery", status: ShipmentStatus.DELIVERED };

    const { getByText, queryByText } = await render(<HandshakeConfirmationResult result={deliveryResult} />);

    expect(getByText(/Entrega confirmada/)).toBeTruthy();
    expect(getByText(/Se lo entregaste\./)).toBeTruthy();
    expect(getByText("El pago se está procesando.")).toBeTruthy();
    expect(queryByText(/destinataria/)).toBeNull();
  });

  it("sin onCtaPress, no muestra ningún botón (sigue sin ser dueño de la navegación)", async () => {
    const { queryByTestId } = await render(
      <HandshakeConfirmationResult testID="hcr" result={baseResult} />,
    );

    expect(queryByTestId("hcr-cta")).toBeNull();
  });

  it("con onCtaPress, tocar el CTA lo dispara con el label default por stage", async () => {
    const onCtaPress = jest.fn();
    const { getByText, getByTestId } = await render(
      <HandshakeConfirmationResult testID="hcr" result={baseResult} onCtaPress={onCtaPress} />,
    );

    expect(getByText("Ver la ruta")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("hcr-cta")));
    expect(onCtaPress).toHaveBeenCalled();
  });

  it("con ctaLabel explícito, lo usa en vez del default", async () => {
    const { getByText } = await render(
      <HandshakeConfirmationResult
        result={{ ...baseResult, stage: "delivery" }}
        onCtaPress={jest.fn()}
        ctaLabel="Volver a Inicio"
      />,
    );

    expect(getByText("Volver a Inicio")).toBeTruthy();
  });
});
