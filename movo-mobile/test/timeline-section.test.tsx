import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentEvent } from "../src/api/shipments-client";
import { TimelineSection } from "../components/shipments/timeline-section";

const mockUseShipmentEvents = jest.fn();
const mockUseShipmentReceiverTransfers = jest.fn((): { data: unknown[] } => ({ data: [] }));
jest.mock("../src/hooks/use-receiver-transfers", () => ({
  useShipmentReceiverTransfers: () => mockUseShipmentReceiverTransfers(),
  useReceiverTransferInvitations: jest.fn(() => ({ data: [] })),
  useCancelReceiverTransfer: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

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

    expect(getByText("Elección del transportista")).toBeTruthy();
    expect(getByText("Reserva del pago")).toBeTruthy();
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

  it("MOVO-253: un rechazo del receptor anterior no toma el nombre del receptor actual", async () => {
    mockUseShipmentEvents.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: [
        event({ id: "e1" }),
        event({
          id: "e2",
          fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          toStatus: ShipmentStatus.REJECTED_BY_RECEIVER,
          actorId: "former-receiver",
          reason: "No estoy en la ciudad",
        }),
        event({
          id: "e3",
          fromStatus: ShipmentStatus.REJECTED_BY_RECEIVER,
          toStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          actorId: "sender-1",
        }),
      ],
    });

    const { getByText, queryByText } = await renderTimeline();

    expect(getByText("El receptor anterior rechazó el envío")).toBeTruthy();
    expect(getByText("Receptor anterior")).toBeTruthy();
    expect(queryByText("Lucas rechazó el envío")).toBeNull();
    expect(getByText("Elegiste otro receptor")).toBeTruthy();
  });

  describe("MOVO-275: transferencia de receptor", () => {
    const transferredEvents = [
      event({ id: "e1" }),
      event({
        id: "e2",
        fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        toStatus: ShipmentStatus.PUBLISHED,
        actorId: "lucia",
        createdAt: "2026-08-15T14:00:00.000Z",
      }),
      event({
        id: "e3",
        fromStatus: ShipmentStatus.ASSIGNED,
        toStatus: ShipmentStatus.IN_TRANSIT,
        actorId: "carrier-1",
        createdAt: "2026-08-16T10:00:00.000Z",
      }),
    ];
    const transfers = [
      {
        id: "tr-rejected",
        shipmentId: "shipment-1",
        requestedBy: "lucia",
        requesterName: "Lucía Gómez",
        newReceiverId: "carla",
        newReceiverName: "Carla Ruiz",
        reason: null,
        responseReason: "Ese día trabajo",
        status: "rejected_by_new_receiver",
        cancelReason: null,
        newReceiverDeadline: "2026-08-16T17:00:00.000Z",
        createdAt: "2026-08-16T11:00:00.000Z",
        resolvedAt: "2026-08-16T11:30:00.000Z",
        resolvedBy: "carla",
      },
      {
        id: "tr-done",
        shipmentId: "shipment-1",
        requestedBy: "lucia",
        requesterName: "Lucía Gómez",
        newReceiverId: "receiver-1",
        newReceiverName: "Martín López",
        reason: "De viaje",
        responseReason: null,
        status: "completed",
        cancelReason: null,
        newReceiverDeadline: "2026-08-16T18:00:00.000Z",
        createdAt: "2026-08-16T12:00:00.000Z",
        resolvedAt: "2026-08-16T12:20:00.000Z",
        resolvedBy: "receiver-1",
      },
    ];
    const partiesAfterTransfer = { ...PARTIES, formerReceiverId: "lucia", formerReceiverName: "Lucía Gómez" };

    beforeEach(() => {
      mockUseShipmentEvents.mockReturnValue({
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        data: transferredEvents,
      });
      mockUseShipmentReceiverTransfers.mockReturnValue({ data: transfers });
      mockUsePublicProfile.mockReturnValue({ data: { id: "receiver-1", fullName: "Martín López" } });
    });

    afterEach(() => {
      mockUseShipmentReceiverTransfers.mockReturnValue({ data: [] });
    });

    it("muestra un item por solicitud, intercalado por fecha, con el texto para quien la pidió", async () => {
      mockUser.mockReturnValue({ userId: "lucia" });

      const { getByText, getByTestId } = await render(
        <TimelineSection shipmentId="shipment-1" parties={partiesAfterTransfer} testID="timeline" />,
      );

      expect(getByText("Le pediste a Carla que lo reciba")).toBeTruthy();
      expect(getByTestId("timeline-transfer-tr-rejected-status")).toHaveTextContent("No aceptó");
      expect(getByText("Le pasaste la recepción a Martín")).toBeTruthy();
      expect(getByTestId("timeline-transfer-tr-done-status")).toHaveTextContent("Completada");
      // El evento de aceptar el envío lo hizo Lucía cuando era la receptora.
      expect(getByText("Aceptaste el envío")).toBeTruthy();
    });

    it("el detalle de la solicitud se despliega con sus pasos", async () => {
      mockUser.mockReturnValue({ userId: "receiver-1" });

      const { getByTestId, queryByTestId, getByText } = await render(
        <TimelineSection shipmentId="shipment-1" parties={partiesAfterTransfer} testID="timeline" />,
      );

      expect(queryByTestId("timeline-transfer-tr-done-steps")).toBeNull();
      await fireEvent.press(getByTestId("timeline-transfer-tr-done-toggle"));
      expect(getByTestId("timeline-transfer-tr-done-steps")).toBeTruthy();
      expect(getByText("Ahora el receptor sos vos")).toBeTruthy();
    });

    it("para el receptor nuevo, aceptar el envío lo hizo la receptora anterior, no él", async () => {
      mockUser.mockReturnValue({ userId: "receiver-1" });

      const { getByText, queryByText } = await render(
        <TimelineSection shipmentId="shipment-1" parties={partiesAfterTransfer} testID="timeline" />,
      );

      expect(getByText("Lucía aceptó el envío")).toBeTruthy();
      expect(queryByText("Aceptaste el envío")).toBeNull();
      expect(getByText("Lucía te pasó la recepción")).toBeTruthy();
    });
  });

  describe("oferta aceptada (assignment_pending)", () => {
    const acceptance = event({
      id: "event-3",
      fromStatus: ShipmentStatus.PUBLISHED,
      toStatus: ShipmentStatus.ASSIGNMENT_PENDING,
      actorId: "sender-1",
      reason: "Oferta f67a9fb1-b384-453b-95aa-6e72de12dab1 aceptada",
    });

    function renderWithCarrier() {
      mockUsePublicProfile.mockImplementation((id: string) => ({
        data: id === "carrier-1" ? { id, fullName: "Juan Pérez" } : { id, fullName: "Lucas Romero" },
      }));
      return render(
        <TimelineSection
          shipmentId="shipment-1"
          parties={{ ...PARTIES, carrierId: "carrier-1" }}
          testID="timeline"
        />,
      );
    }

    it("muestra la elección del transportista, el pago pendiente y oculta el motivo interno", async () => {
      mockUseShipmentEvents.mockReturnValue({
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        data: [event(), acceptance],
      });

      const { getByText, queryByText } = await renderWithCarrier();

      expect(getByText("Elegiste a Juan como transportista")).toBeTruthy();
      expect(getByText("Falta reservar el pago")).toBeTruthy();
      expect(queryByText("Buscando transportista")).toBeNull();
      expect(queryByText(/Oferta f67a9fb1/)).toBeNull();
      // El próximo paso es la reserva del pago, no la asignación.
      expect(getByText("Reserva del pago")).toBeTruthy();
      expect(queryByText("Asignación del transportista")).toBeNull();
    });

    it("sigue mostrando el motivo de una cancelación", async () => {
      mockUseShipmentEvents.mockReturnValue({
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        data: [
          event(),
          event({
            id: "event-4",
            fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
            toStatus: ShipmentStatus.CANCELLED,
            actorId: null,
            reason: "El receptor no confirmó dentro del plazo",
          }),
        ],
      });

      const { getByText } = await renderWithCarrier();

      expect(getByText("El receptor no confirmó dentro del plazo")).toBeTruthy();
    });
  });
});
