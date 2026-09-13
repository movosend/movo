import { KycStatus } from "@movo/shared/dist/types/user";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import AuthenticatedHomeScreen from "../app/(app)/(tabs)/home";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

const mockUseMyProfile = jest.fn();
const mockUpdateKycStatus = jest.fn();
const mockUseRecentShipments = jest.fn();
const mockUseSendingShipments = jest.fn();
const mockUseReceivingShipments = jest.fn();
const mockUseAttentionTasks = jest.fn();

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
}));

jest.mock("../src/hooks/use-attention-tasks", () => ({
  useAttentionTasks: () => mockUseAttentionTasks(),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: { getState: () => ({ updateKycStatus: mockUpdateKycStatus }) },
}));

// MOVO-83: home rediseñada — saludo + banner KYC (sin cambios de MOVO-76) + CTA de
// envío + actividad reciente.
describe("AuthenticatedHomeScreen", () => {
  beforeEach(() => {
    mockUseMyProfile.mockReturnValue({ data: { kycStatus: KycStatus.APPROVED, firstName: "Martina" } });
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], page: 1, limit: 3, total: 0 },
      refetch: jest.fn(),
    });
    mockUseSendingShipments.mockReturnValue({ data: [] });
    mockUseReceivingShipments.mockReturnValue({ data: [] });
    mockUseAttentionTasks.mockReturnValue({ tasks: [], isLoading: false });
  });

  afterEach(() => jest.clearAllMocks());

  it("saluda al usuario y muestra la CTA de enviar un paquete", async () => {
    const { getByTestId, getByText } = await render(<AuthenticatedHomeScreen />);

    expect(getByTestId("app-home-welcome")).toHaveTextContent("Hola, Martina");
    expect(getByTestId("app-home-send-cta")).toBeTruthy();
    expect(getByText("Coordiná un envío con un transportista verificado")).toBeTruthy();
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
          pickupDate: "2026-09-15",
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
});
