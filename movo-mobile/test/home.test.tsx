import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { RefreshControl } from "react-native";
import AuthenticatedHomeScreen from "../app/(app)/(tabs)/home";

// MOVO-117: la checklist de requisitos ante un 403 se testea aparte; acá se usa el doble del hook.
jest.mock("../src/hooks/use-carrier-requirements-sheet", () =>
  require("./mocks/carrier-requirements-sheet-hook"),
);

// El gate de ubicación del transportista tiene su propio test
// (carrier-location-gate.test.tsx): acá se asume que ya cumple los requisitos.
jest.mock("../src/store/carrier-location-gate-store", () => ({
  requireCarrierLocation: (action: () => unknown) => action(),
}));

const mockSearchParams = jest.fn(() => ({}) as Record<string, string>);

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams(),
  useIsFocused: () => true,
}));
// MOVO-169: Inicio decide el último paso del tutorial según si ya puede transportar.
jest.mock("../src/hooks/use-transport-gate", () => ({
  useTransportGate: () => ({ canBrowse: false, isRequirementsLoading: false }),
}));

const mockUseMyProfile = jest.fn();
const mockUpdateKycStatus = jest.fn();
const mockUseRecentShipments = jest.fn();
const mockUseSendingShipments = jest.fn();
const mockUseReceivingShipments = jest.fn();
const mockUseTransportingShipments = jest.fn();
const mockUseAttentionTasks = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockUseMyTrips = jest.fn();
const mockStartTripMutateAsync = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock("../src/hooks/use-trips", () => ({
  useMyTrips: () => mockUseMyTrips(),
  useStartTrip: () => ({
    mutateAsync: mockStartTripMutateAsync,
    isPending: false,
  }),
}));

jest.mock("../src/hooks/use-auth", () => {
  const { KycStatus } = jest.requireActual("@movo/shared/dist/types/user");
  return {
    useAuth: () => ({
      user: { fullName: "Martina Zurita", kycStatus: KycStatus.APPROVED },
      logout: jest.fn(),
    }),
  };
});

jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => mockUseMyProfile(),
}));

jest.mock("../src/hooks/use-shipments", () => ({
  useRecentShipments: () => mockUseRecentShipments(),
}));

jest.mock("../src/hooks/use-active-shipments", () => ({
  useSendingShipments: () => mockUseSendingShipments(),
  useReceivingShipments: () => mockUseReceivingShipments(),
  useTransportingShipments: () => mockUseTransportingShipments(),
}));

const mockUseChatList = jest.fn();
jest.mock("../src/hooks/use-chat", () => ({
  useChatList: () => mockUseChatList(),
  totalUnread: (items: { unreadCount: number }[] | undefined) => (items ?? []).reduce((sum, i) => sum + i.unreadCount, 0),
}));

jest.mock("../src/hooks/use-attention-tasks", () => ({
  useAttentionTasks: () => mockUseAttentionTasks(),
}));

jest.mock("../src/hooks/use-carrier-tracking", () => ({
  useCarrierTracking: () => ({
    isTracking: false,
    inTransitCount: 0,
    pendingQueueCount: 0,
    permissionGranted: true,
    lastReportedAt: null,
    lastError: null,
    requestPermission: jest.fn(),
    flushQueue: jest.fn(),
  }),
}));

// Hook con selector (`RecentShipmentsSection` lee el usuario, MOVO-253) + `getState`.
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: { userId: string } }) => unknown) => selector({ user: { userId: "me" } }),
    { getState: () => ({ updateKycStatus: mockUpdateKycStatus }) },
  ),
}));

// MOVO-83: home rediseñada — saludo + banner KYC (sin cambios de MOVO-76) + CTA de
// envío + actividad reciente.
describe("AuthenticatedHomeScreen", () => {
  beforeEach(() => {
    mockUseChatList.mockReturnValue({ data: [] });
    mockUseMyProfile.mockReturnValue({
      data: { kycStatus: KycStatus.APPROVED, firstName: "Martina", roles: [UserRole.SENDER, UserRole.CARRIER] },
    });
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], page: 1, limit: 3, total: 0 },
      refetch: jest.fn(),
    });
    mockUseSendingShipments.mockReturnValue({ data: [] });
    mockUseReceivingShipments.mockReturnValue({ data: [] });
    mockUseTransportingShipments.mockReturnValue({ data: [] });
    mockUseAttentionTasks.mockReturnValue({ tasks: [], isLoading: false });
    mockUseMyTrips.mockReturnValue({ data: { items: [], total: 0 } });
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockSearchParams.mockReturnValue({});
  });

  it("MOVO-314: tras bajarse de un envío muestra el aviso que llega por parámetro", async () => {
    mockSearchParams.mockReturnValue({
      withdrawnNotice: "Cancelaste el envío. Registramos una deuda de $2.450.",
      withdrawnAt: "1",
    });
    const { getByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-withdrawn-banner")).toHaveTextContent("Cancelaste el envío. Registramos una deuda de $2.450.");
  });

  it("sin aviso por parámetro no hay banner de baja", async () => {
    const { queryByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(queryByTestId("app-home-withdrawn-banner")).toBeNull();
  });

  it("saluda al usuario y muestra la CTA de enviar un paquete", async () => {
    const { getByTestId, getByText } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-welcome")).toHaveTextContent("Hola, Martina");
    expect(getByTestId("app-home-send-cta")).toBeTruthy();
    expect(getByText("Coordiná un envío con un transportista verificado")).toBeTruthy();
  });

  it("MOVO-284: el ícono de chats del header suma los no leídos y abre la lista", async () => {
    mockUseChatList.mockReturnValue({
      data: [
        { shipmentId: "s1", unreadCount: 2 },
        { shipmentId: "s2", unreadCount: 1 },
      ],
    });
    const { getByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-chats-badge")).toHaveTextContent("3");
    await fireEvent.press(getByTestId("app-home-chats"));
    expect(router.push).toHaveBeenCalledWith("/(app)/chats");
  });

  it("MOVO-284: sin mensajes sin leer el ícono queda sin contador", async () => {
    mockUseChatList.mockReturnValue({ data: [{ shipmentId: "s1", unreadCount: 0 }] });
    const { getByTestId, queryByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-chats")).toBeTruthy();
    expect(queryByTestId("app-home-chats-badge")).toBeNull();
  });

  it("no renderiza 'Estoy transportando' si no hay viajes activos ni declarados con paquetes", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [], total: 0 } });
    const { queryByTestId } = await render(<AuthenticatedHomeScreen />);
    expect(queryByTestId("app-home-transporting")).toBeNull();
  });

  it("renderiza 'Estoy transportando' con card y botón 'Iniciar viaje' para viaje declared con paquetes aceptados", async () => {
    mockUseMyTrips.mockReturnValue({
      data: {
        items: [
          {
            id: "trip-declared-1",
            carrierId: "me",
            originAddress: "Av. Colón 100, Córdoba",
            originLat: -31.4,
            originLng: -64.18,
            destinationAddress: "San Martín 200, Villa Carlos Paz",
            destinationLat: -31.42,
            destinationLng: -64.49,
            departureAt: new Date().toISOString(),
            vehicleType: "car",
            status: "declared",
            hasAcceptedPackages: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      },
    });

    const { getByTestId, getByText } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-transporting")).toBeTruthy();
    expect(getByText(/estoy transportando/i)).toBeTruthy();
    expect(getByText("Iniciar viaje")).toBeTruthy();

    fireEvent.press(getByText("Iniciar viaje"));
    expect(mockStartTripMutateAsync).toHaveBeenCalledWith("trip-declared-1");
  });

  it("muestra la fecha del día y navega a Mi perfil al tocar el avatar", async () => {
    const { getByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-date")).toBeTruthy();

    fireEvent.press(getByTestId("app-home-avatar"));

    expect(router.push).toHaveBeenCalledWith("/profile");
  });

  it("muestra la sección de actividad reciente", async () => {
    const { getByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-recent-shipments")).toBeTruthy();
  });

  it("no muestra el banner de KYC cuando ya está aprobado", async () => {
    const { queryByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(queryByTestId("app-home-kyc-banner")).toBeNull();
  });

  it("muestra el banner de KYC cuando todavía no está aprobado", async () => {
    mockUseMyProfile.mockReturnValue({ data: { kycStatus: KycStatus.NOT_STARTED, firstName: "Martina" } });

    const { getByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-kyc-banner")).toBeTruthy();
  });

  it("prefiere el firstName real de GET /users/me sobre partir el fullName de la sesión", async () => {
    // `user.fullName` (mock de arriba) es "Martina Zurita" — si el saludo usara
    // `getFirstName(fullName)` acá igual daría "Martina", así que este caso fuerza un
    // primer nombre distinto para probar que el dato viene de la API, no del split.
    mockUseMyProfile.mockReturnValue({ data: { kycStatus: KycStatus.APPROVED, firstName: "Mica" } });

    const { getByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-welcome")).toHaveTextContent("Hola, Mica");
  });

  it("cae a partir el fullName de la sesión mientras el perfil todavía no cargó", async () => {
    mockUseMyProfile.mockReturnValue({ data: undefined });

    const { getByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-welcome")).toHaveTextContent("Hola, Martina");
  });

  // MOVO-193: secciones de envíos activos por rol y "Requiere tu atención".
  it("no renderiza las secciones de envíos activos ni tareas sin datos", async () => {
    const { queryByTestId } = await render(<AuthenticatedHomeScreen />);

    expect(queryByTestId("app-home-sending")).toBeNull();
    expect(queryByTestId("app-home-receiving")).toBeNull();
    expect(queryByTestId("app-home-attention")).toBeNull();
  });

  it("renderiza 'Estoy enviando' con una card por envío activo", async () => {
    mockUseSendingShipments.mockReturnValue({
      data: [
        {
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
          pickupWindowExpired: false,
        },
      ],
    });

    const { getByTestId, getByText } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-sending")).toBeTruthy();
    expect(getByText("Lucía Gómez")).toBeTruthy();
    expect(getByText("Generar retiro")).toBeTruthy();
  });

  it("renderiza 'Requiere tu atención' con las tareas del hook", async () => {
    mockUseAttentionTasks.mockReturnValue({
      tasks: [
        {
          kind: "info",
          id: "rejected-s1",
          title: "El receptor rechazó tu envío",
          meta: "San Martín 450",
          onPress: jest.fn(),
          primaryLabel: "Ver envío",
          onPrimary: jest.fn(),
        },
      ],
      isLoading: false,
    });

    const { getByTestId, getByText } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-attention")).toBeTruthy();
    expect(getByText("El receptor rechazó tu envío")).toBeTruthy();
  });

  it("MOVO-284: el pull-to-refresh también refresca la lista de chats", async () => {
    const { toJSON } = await render(<AuthenticatedHomeScreen />);
    const findNode = (node: any, type: string): any => {
      if (!node) return null;
      if (node.type === type) return node;
      for (const c of node.children ?? []) {
        const found = findNode(c, type);
        if (found) return found;
      }
      return null;
    };
    const refreshControl = findNode(toJSON(), "RCTScrollView")?.props?.refreshControl;

    await act(async () => {
      await refreshControl.props.onRefresh();
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["chat", "list"] });
  });

  it("renderiza refresh control para pull-to-refresh", async () => {
    const { toJSON } = await render(<AuthenticatedHomeScreen />);
    const findNode = (node: any, type: string): any => {
      if (!node) return null;
      if (node.type === type) return node;
      if (node.children) {
        for (const c of node.children) {
          const found = findNode(c, type);
          if (found) return found;
        }
      }
      return null;
    };
    const scrollViewNode = findNode(toJSON(), "RCTScrollView");
    expect(scrollViewNode?.props?.refreshControl).toBeTruthy();
  });
  // MOVO-168: cada sección carga y falla por su cuenta; el resto de Inicio no se entera.
  describe("carga granular por sección (MOVO-168)", () => {
    const ACTIVE_SHIPMENT = {
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
      pickupWindowExpired: false,
    };

    it("una sección cargando muestra su skeleton y la que ya cargó se ve sin esperarla", async () => {
      mockUseSendingShipments.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: jest.fn() });
      mockUseReceivingShipments.mockReturnValue({ data: [ACTIVE_SHIPMENT], isLoading: false, isError: false });

      const { getByTestId, getByText, queryByTestId } = await render(<AuthenticatedHomeScreen />);

      expect(getByTestId("app-home-sending-skeleton")).toBeTruthy();
      expect(getByTestId("app-home-receiving")).toBeTruthy();
      expect(getByText("Lucía Gómez")).toBeTruthy();
      expect(queryByTestId("app-home-receiving-skeleton")).toBeNull();
      // La pantalla sigue viva: saludo, CTA y actividad reciente no esperan a nadie.
      expect(getByTestId("app-home-welcome")).toBeTruthy();
      expect(getByTestId("app-home-send-cta")).toBeTruthy();
      expect(getByTestId("app-home-recent-shipments")).toBeTruthy();
    });

    it("una sección que falla muestra su error con Reintentar local y no toca a las demás", async () => {
      const refetchSending = jest.fn();
      mockUseSendingShipments.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: refetchSending,
      });
      mockUseReceivingShipments.mockReturnValue({ data: [ACTIVE_SHIPMENT], isLoading: false, isError: false });

      const { getByTestId, getByText } = await render(<AuthenticatedHomeScreen />);

      expect(getByTestId("app-home-sending-error")).toBeTruthy();
      expect(getByText("Lucía Gómez")).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId("app-home-sending-error-retry"));
      });
      expect(refetchSending).toHaveBeenCalledTimes(1);
    });

    it("con envíos ya cargados, un refetch fallido no reemplaza la lista por el error", async () => {
      mockUseSendingShipments.mockReturnValue({
        data: [ACTIVE_SHIPMENT],
        isLoading: false,
        isError: true,
        refetch: jest.fn(),
      });

      const { getByText, queryByTestId } = await render(<AuthenticatedHomeScreen />);

      expect(getByText("Lucía Gómez")).toBeTruthy();
      expect(queryByTestId("app-home-sending-error")).toBeNull();
    });

    it("'Requiere tu atención' muestra su skeleton mientras carga", async () => {
      mockUseAttentionTasks.mockReturnValue({ tasks: [], isLoading: true, isError: false, refetch: jest.fn() });

      const { getByTestId } = await render(<AuthenticatedHomeScreen />);

      expect(getByTestId("app-home-attention-skeleton")).toBeTruthy();
    });

    it("'Requiere tu atención' muestra su error con Reintentar local si falla", async () => {
      const refetchAttention = jest.fn();
      mockUseAttentionTasks.mockReturnValue({ tasks: [], isLoading: false, isError: true, refetch: refetchAttention });

      const { getByTestId, queryByTestId } = await render(<AuthenticatedHomeScreen />);

      expect(queryByTestId("app-home-attention-skeleton")).toBeNull();
      await act(async () => {
        fireEvent.press(getByTestId("app-home-attention-error-retry"));
      });
      expect(refetchAttention).toHaveBeenCalledTimes(1);
    });

    it("'Estoy transportando' muestra su skeleton mientras cargan los viajes", async () => {
      mockUseMyTrips.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: jest.fn() });

      const { getByTestId } = await render(<AuthenticatedHomeScreen />);

      expect(getByTestId("app-home-transporting-skeleton")).toBeTruthy();
    });

    it("un emisor sin rol de transportista no ve skeleton ni error de 'Estoy transportando'", async () => {
      mockUseMyProfile.mockReturnValue({
        data: { kycStatus: KycStatus.APPROVED, firstName: "Martina", roles: [UserRole.SENDER] },
      });
      mockUseMyTrips.mockReturnValue({ data: undefined, isLoading: true, isError: true, refetch: jest.fn() });

      const { queryByTestId } = await render(<AuthenticatedHomeScreen />);

      expect(queryByTestId("app-home-transporting-skeleton")).toBeNull();
      expect(queryByTestId("app-home-transporting-error")).toBeNull();
    });

    it("'Estoy transportando' muestra su error con Reintentar local si fallan los viajes", async () => {
      const refetchTrips = jest.fn();
      mockUseMyTrips.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: refetchTrips });

      const { getByTestId } = await render(<AuthenticatedHomeScreen />);

      await act(async () => {
        fireEvent.press(getByTestId("app-home-transporting-error-retry"));
      });
      expect(refetchTrips).toHaveBeenCalledTimes(1);
    });

    it("sin datos pero sin error ni carga (cargó vacío), las secciones no dejan rastro", async () => {
      const { queryByTestId } = await render(<AuthenticatedHomeScreen />);

      for (const id of ["sending", "receiving", "attention", "transporting"]) {
        expect(queryByTestId(`app-home-${id}-skeleton`)).toBeNull();
        expect(queryByTestId(`app-home-${id}-error`)).toBeNull();
      }
    });
  });
});
