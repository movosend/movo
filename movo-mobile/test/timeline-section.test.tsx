import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentEvent } from "../src/api/shipments-client";
import { TimelineSection } from "../components/shipments/timeline-section";

const mockUseShipmentEvents = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipmentEvents: (...args: unknown[]) => mockUseShipmentEvents(...args),
}));

const mockUser = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { userId: string } | null }) => unknown) =>
    selector({ user: mockUser() }),
}));

const PARTIES = { senderId: "sender-1", receiverId: "receiver-1", carrierId: "carrier-1" };

function event(overrides: Partial<ShipmentEvent> = {}): ShipmentEvent {
  return {
    id: "event-1",
    shipmentId: "shipment-1",
    fromStatus: null,
    toStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
    actorId: "sender-1",
    reason: null,
    createdAt: "2026-08-15T13:00:00.000Z",
    ...overrides,
  };
}

function renderTimeline() {
  return render(<TimelineSection shipmentId="shipment-1" parties={PARTIES} testID="timeline" />);
}

describe("TimelineSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockReturnValue({ userId: "sender-1" });
  });

  it("muestra el skeleton mientras carga", async () => {
    mockUseShipmentEvents.mockReturnValue({ isLoading: true, isError: false, refetch: jest.fn() });

    const { getByTestId, queryByText } = await renderTimeline();

    expect(getByTestId("timeline")).toBeTruthy();
    expect(queryByText("Envío creado")).toBeNull();
  });

  it("muestra el estado vacío cuando el envío todavía no tiene eventos", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [],
      refetch: jest.fn(),
    });

    const { getByText } = await renderTimeline();

    expect(getByText("Todavía no hay movimientos registrados")).toBeTruthy();
  });

  it("muestra el error con reintento cuando falla el historial", async () => {
    const refetch = jest.fn();
    mockUseShipmentEvents.mockReturnValue({ isLoading: false, isError: true, refetch });

    const { getByText } = await renderTimeline();

    await fireEvent.press(getByText("Reintentar"));

    expect(refetch).toHaveBeenCalled();
  });

  it("lista los eventos en el orden que los devuelve el backend, con el título del evento inicial", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: [
        event(),
        event({
          id: "event-2",
          fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          toStatus: ShipmentStatus.PUBLISHED,
          actorId: "receiver-1",
        }),
      ],
    });

    const { getByText } = await renderTimeline();

    // `fromStatus: null` se lee como la creación del envío, no como "esperando
    // confirmación" (que es el estado, no lo que pasó).
    expect(getByText("Envío creado")).toBeTruthy();
    expect(getByText("Publicado para transportistas")).toBeTruthy();
  });

  it("resuelve el actor contra las partes del envío sin pedir el perfil", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: [
        event({ actorId: "sender-1" }),
        event({
          id: "event-2",
          fromStatus: ShipmentStatus.ASSIGNED,
          toStatus: ShipmentStatus.IN_TRANSIT,
          actorId: "carrier-1",
        }),
      ],
    });

    const { getByText } = await renderTimeline();

    // El usuario logueado es el emisor: su propio evento se lee en primera persona.
    expect(getByText("Vos")).toBeTruthy();
    expect(getByText("El transportista")).toBeTruthy();
  });

  it("proyecta los pasos que faltan, sin fecha ni actor, después del último evento", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: [
        event(),
        event({
          id: "event-2",
          fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          toStatus: ShipmentStatus.PUBLISHED,
        }),
      ],
    });

    const { getByText } = await renderTimeline();

    expect(getByText("Búsqueda de transportista")).toBeTruthy();
    expect(getByText("Asignación del transportista")).toBeTruthy();
    expect(getByText("Retiro del paquete")).toBeTruthy();
    expect(getByText("Entrega al receptor")).toBeTruthy();
  });

  it("no proyecta pasos futuros cuando el envío salió del camino feliz", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: [
        event(),
        event({
          id: "event-2",
          fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          toStatus: ShipmentStatus.CANCELLED,
        }),
      ],
    });

    const { queryByText } = await renderTimeline();

    // Prometer "Entrega al receptor" debajo de un envío cancelado sería mentir.
    expect(queryByText("Entrega al receptor")).toBeNull();
    expect(queryByText("Retiro del paquete")).toBeNull();
  });

  it("muestra el motivo del evento cuando el backend lo manda", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: [
        event({
          fromStatus: ShipmentStatus.PUBLISHED,
          toStatus: ShipmentStatus.CANCELLED,
          reason: "El emisor canceló antes de asignar transportista",
        }),
      ],
    });

    const { getByText } = await renderTimeline();

    expect(getByText("El emisor canceló antes de asignar transportista")).toBeTruthy();
  });
});
