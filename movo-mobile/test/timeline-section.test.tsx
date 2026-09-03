import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentEvent } from "../src/api/shipments-client";
import { TimelineSection } from "../components/shipments/timeline-section";

const mockUseShipmentEvents = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipmentEvents: (...args: unknown[]) => mockUseShipmentEvents(...args),
}));

const mockUsePublicProfile = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (id: string) => mockUsePublicProfile(id),
}));

const mockUseShipmentRatings = jest.fn();
jest.mock("../src/hooks/use-ratings", () => ({
  useShipmentRatings: (...args: unknown[]) => mockUseShipmentRatings(...args),
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
    mockUsePublicProfile.mockReturnValue({ data: { id: "receiver-1", fullName: "Lucas Romero" } });
    mockUseShipmentRatings.mockReturnValue({ data: [] });
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

  it("lista los eventos en el orden que los devuelve el backend, con el nombre del receptor", async () => {
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

    // `fromStatus: null` se lee como la creación del envío
    expect(getByText("Envío creado")).toBeTruthy();
    // La transición a `published` nombra al receptor por su firstName
    expect(getByText("Lucas aceptó el envío")).toBeTruthy();
    expect(getByText("Publicado para transportistas")).toBeTruthy();
    expect(getByText("Lucas")).toBeTruthy();
  });

  it("resuelve el actor contra las partes del envío y muestra el nombre del receptor", async () => {
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
        event({
          id: "event-3",
          fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          toStatus: ShipmentStatus.PUBLISHED,
          actorId: "receiver-1",
        }),
      ],
    });

    const { getByText } = await renderTimeline();

    // El usuario logueado es el emisor: su propio evento se lee en primera persona.
    expect(getByText("Vos")).toBeTruthy();
    expect(getByText("El transportista")).toBeTruthy();
    expect(getByText("Lucas")).toBeTruthy();
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
    expect(getByText("Entrega a Lucas")).toBeTruthy();
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

  it("muestra copy en segunda persona cuando el usuario logueado es el receptor", async () => {
    mockUser.mockReturnValue({ userId: "receiver-1" });
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

    const { getByText, queryByText } = await renderTimeline();

    expect(getByText("Aceptaste el envío")).toBeTruthy();
    expect(getByText("Vos")).toBeTruthy();
    expect(queryByText("Lucas aceptó el envío")).toBeNull();
  });

  it("muestra las calificaciones realizadas en la línea de tiempo", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: [
        event({
          id: "event-1",
          toStatus: ShipmentStatus.DELIVERED,
        }),
      ],
    });
    mockUseShipmentRatings.mockReturnValue({
      data: [
        {
          id: "r-1",
          shipmentId: "shipment-1",
          raterId: "sender-1",
          rateeId: "carrier-1",
          role: "carrier",
          score: 5,
          comment: "Llegó todo en perfecto estado",
          createdAt: "2026-09-01T14:00:00.000Z",
        },
      ],
    });
    mockUsePublicProfile.mockImplementation((id: string) => ({
      data: {
        id,
        fullName: id === "carrier-1" ? "Marta Conductora" : "Lucas Romero",
      },
    }));

    const { getByTestId, getByText } = await renderTimeline();

    expect(getByTestId("timeline-ratings-section")).toBeTruthy();
    expect(getByText("Calificaciones (1)")).toBeTruthy();
    expect(getByText('"Llegó todo en perfecto estado"')).toBeTruthy();
  });
});
