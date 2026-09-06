import { render } from "@testing-library/react-native";
import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import PublicProfileScreen from "../app/(app)/profile/[id]";

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({ id: "user-2" }),
}));

const mockUsePublicProfile = jest.fn();
const mockUseMutualConnections = jest.fn();

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (...args: unknown[]) => mockUsePublicProfile(...args),
  useMutualConnections: (...args: unknown[]) => mockUseMutualConnections(...args),
}));

const mockUseSharedHistory = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useSharedHistory: (...args: unknown[]) => mockUseSharedHistory(...args),
}));

jest.mock("../src/hooks/use-moderation", () => ({
  useReportUser: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useBlockUser: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { userId: string } | null }) => unknown) =>
    selector({ user: { userId: "current-user" } }),
}));

jest.mock("@react-native-menu/menu", () => {
  const { View } = require("react-native");
  return { MenuView: ({ testID, children }: any) => <View testID={testID}>{children}</View> };
});

function baseProfile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: "user-2",
    fullName: "Julia Bertolino",
    photoUrl: null,
    isVerified: true,
    badges: ["kyc_verified"],
    transactionCounts: { asSender: 0, asCarrier: 5 },
    reputationScore: 4.9,
    ratingCount: 5,
    isNewProfile: false,
    asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
    asCarrier: { reputationScore: 4.9, ratingCount: 5, isNewProfile: false },
    recentRatingComments: [],
    memberSince: "2026-01-01T00:00:00.000Z",
    phoneVerified: true,
    emailVerified: true,
    bio: null,
    ...overrides,
  };
}

describe("PublicProfileScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSharedHistory.mockReturnValue({ data: undefined });
    mockUseMutualConnections.mockReturnValue({ data: undefined });
  });

  it("muestra el skeleton mientras carga", async () => {
    mockUsePublicProfile.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { getByTestId } = await render(<PublicProfileScreen />);

    expect(getByTestId("profile-detail-skeleton")).toBeTruthy();
  });

  it("muestra un error si el perfil no pudo cargarse", async () => {
    mockUsePublicProfile.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    const { getByTestId } = await render(<PublicProfileScreen />);

    expect(getByTestId("profile-detail-error")).toBeTruthy();
  });

  it("muestra el estado 'perfil nuevo' con las garantías estáticas, sin card de reputación", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: baseProfile({ isNewProfile: true, reputationScore: null, ratingCount: 0 }),
      isLoading: false,
      isError: false,
    });

    const { getByText, queryByTestId } = await render(<PublicProfileScreen />);

    expect(getByText("Todavía no tiene calificaciones. La identidad sí está chequeada.")).toBeTruthy();
    expect(queryByTestId("profile-detail-reputation")).toBeNull();
  });

  it("muestra la card de reputación y las stats de uso cuando no es perfil nuevo", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: baseProfile({
        asCarrier: {
          reputationScore: 4.9,
          ratingCount: 5,
          isNewProfile: false,
          usageStats: { delivered: 10, cancelled: 0, avgPackageWeightKg: 2.5 },
        },
      }),
      isLoading: false,
      isError: false,
    });

    const { getByTestId, getByText } = await render(<PublicProfileScreen />);

    expect(getByTestId("profile-detail-reputation")).toBeTruthy();
    expect(getByTestId("profile-detail-usage-stats")).toBeTruthy();
    expect(getByText("Entregas")).toBeTruthy();
  });

  it("no muestra el menú de reportar/bloquear en el perfil propio", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: baseProfile({ id: "current-user" }),
      isLoading: false,
      isError: false,
    });

    const { queryByTestId } = await render(<PublicProfileScreen />);

    expect(queryByTestId("profile-detail-actions")).toBeNull();
  });

  it("muestra el menú de reportar/bloquear en el perfil de otra persona", async () => {
    mockUsePublicProfile.mockReturnValue({ data: baseProfile(), isLoading: false, isError: false });

    const { getByTestId } = await render(<PublicProfileScreen />);

    expect(getByTestId("profile-detail-actions")).toBeTruthy();
  });

  it("muestra el label genérico que resuelve el backend para un calificador con cuenta borrada (MOVO-39)", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: baseProfile({
        recentRatingComments: [
          {
            id: "r1",
            raterId: "u9",
            raterName: "Un usuario de Movo",
            score: 5,
            comment: "Excelente",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
      isLoading: false,
      isError: false,
    });

    const { getByText } = await render(<PublicProfileScreen />);

    expect(getByText("Un usuario de Movo")).toBeTruthy();
  });

  it("muestra el nombre real del calificador cuando viene (MOVO-170)", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: baseProfile({
        recentRatingComments: [
          {
            id: "r1",
            raterId: "u9",
            raterName: "Malena G.",
            score: 5,
            comment: "Excelente",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
      isLoading: false,
      isError: false,
    });

    const { getByText } = await render(<PublicProfileScreen />);

    expect(getByText("Malena G.")).toBeTruthy();
  });

  it("muestra el historial compartido cuando el hook lo resuelve (MOVO-170, todavía sin backend)", async () => {
    mockUsePublicProfile.mockReturnValue({ data: baseProfile(), isLoading: false, isError: false });
    mockUseSharedHistory.mockReturnValue({
      data: { sharedShipmentCount: 3, lastSharedAt: "2026-08-01T00:00:00.000Z", allDelivered: true },
    });

    const { getByTestId, getByText } = await render(<PublicProfileScreen />);

    expect(getByTestId("profile-detail-shared-history")).toBeTruthy();
    expect(getByText("Ya enviaste 3 paquetes con esta persona.")).toBeTruthy();
  });

  it("no muestra la ficha de vehículo si no está cargada", async () => {
    mockUsePublicProfile.mockReturnValue({ data: baseProfile(), isLoading: false, isError: false });

    const { queryByTestId } = await render(<PublicProfileScreen />);

    expect(queryByTestId("profile-detail-vehicle")).toBeNull();
  });
});
