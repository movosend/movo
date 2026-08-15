import { fireEvent, render, within } from "@testing-library/react-native";
import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import { router } from "expo-router";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import ProfileScreen from "../app/(app)/(tabs)/profile";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

const mockLogout = jest.fn();
const mockRefetch = jest.fn();
const mockUseMyProfile = jest.fn();
const mockInvalidateQueries = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock("../src/hooks/use-auth", () => ({
  useAuth: () => ({ logout: mockLogout }),
}));

jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => mockUseMyProfile(),
}));

function baseProfile(overrides: Partial<PrivateProfile> = {}): PrivateProfile {
  return {
    id: "user-1",
    firstName: "Martina",
    lastName: "Zurita",
    fullName: "Martina Zurita",
    email: "martina.zurita@gmail.com",
    phone: "+5491140238871",
    photoUrl: null,
    kycStatus: KycStatus.APPROVED,
    // approved por default para no interferir con los tests existentes del banner de
    // identidad (ambos banners comparten el label "Reintentar verificación" en la
    // mayoría de los estados) — los tests de MOVO-15 lo pisan explícitamente.
    licenseKycStatus: KycStatus.APPROVED,
    accountStatus: "active" as never,
    roles: [UserRole.SENDER, UserRole.CARRIER],
    badges: ["kyc_verified"],
    transactionCounts: { asSender: 0, asCarrier: 0 },
    reputationScore: null,
    ...overrides,
  };
}

// MOVO-78: pantalla de perfil propio — loading/error/estados de KYC/logout.
describe("ProfileScreen", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra el skeleton mientras carga (AC8)", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);

    expect(getByTestId("profile-skeleton")).toBeTruthy();
  });

  it("muestra el estado de error con reintentar ante un fallo de red (AC8)", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("network"),
      data: undefined,
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);

    fireEvent.press(getByTestId("profile-error-retry"));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("AC10: contadores en cero y sin score muestran los textos de 'sin dato', nunca 0/null/NaN", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile(),
      refetch: mockRefetch,
    });

    const { getByTestId, queryByText } = await render(<ProfileScreen />);
    const statsRow = getByTestId("profile-stats-row");

    expect(within(statsRow).getByText("Sin envíos aún")).toBeTruthy();
    expect(within(statsRow).getByText("Sin viajes aún")).toBeTruthy();
    expect(within(statsRow).getByText("Sin calificaciones")).toBeTruthy();
    expect(queryByText("0")).toBeNull();
    expect(queryByText("null")).toBeNull();
    expect(queryByText("NaN")).toBeNull();
  });

  it("no muestra banner de KYC cuando el estado es approved", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ kycStatus: KycStatus.APPROVED }),
      refetch: mockRefetch,
    });

    const { queryByTestId } = await render(<ProfileScreen />);

    expect(queryByTestId("profile-kyc-banner")).toBeNull();
  });

  it("AC6: manual_review ofrece 'Ver estado' y navega a /kyc", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ kycStatus: KycStatus.MANUAL_REVIEW }),
      refetch: mockRefetch,
    });

    const { getByText } = await render(<ProfileScreen />);

    fireEvent.press(getByText("Ver estado"));
    expect(router.push).toHaveBeenCalledWith("/kyc");
  });

  it("AC6: rejected ofrece 'Reintentar verificación'", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ kycStatus: KycStatus.REJECTED }),
      refetch: mockRefetch,
    });

    const { getByText } = await render(<ProfileScreen />);

    expect(getByText("Reintentar verificación")).toBeTruthy();
  });

  // MOVO-15: banner de licencia, análogo al de identidad — mismos casos clave
  // (oculto en approved, visible con CTA en el resto), más el gate específico de rol.
  it("no muestra el banner de licencia si el usuario no tiene rol carrier", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ roles: [UserRole.SENDER], licenseKycStatus: KycStatus.NOT_STARTED }),
      refetch: mockRefetch,
    });

    const { queryByTestId } = await render(<ProfileScreen />);

    expect(queryByTestId("profile-license-banner")).toBeNull();
  });

  it("muestra el banner de licencia con rol carrier y estado no aprobado", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ licenseKycStatus: KycStatus.NOT_STARTED }),
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);

    expect(getByTestId("profile-license-banner")).toBeTruthy();
  });

  it("no muestra el banner de licencia cuando el estado es approved, aunque el rol sea carrier", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ licenseKycStatus: KycStatus.APPROVED }),
      refetch: mockRefetch,
    });

    const { queryByTestId } = await render(<ProfileScreen />);

    expect(queryByTestId("profile-license-banner")).toBeNull();
  });

  it("el banner de licencia en manual_review navega a /license-kyc al tocar 'Ver estado'", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ licenseKycStatus: KycStatus.MANUAL_REVIEW }),
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);

    fireEvent.press(within(getByTestId("profile-license-banner")).getByText("Ver estado"));
    expect(router.push).toHaveBeenCalledWith("/license-kyc");
  });

  it("AC7: dispara logout al tocar 'Cerrar sesión'", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile(),
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);

    fireEvent.press(getByTestId("profile-logout-button"));
    expect(mockLogout).toHaveBeenCalled();
  });

  it("MOVO-98: renderiza el PhotoPicker interactivo con la foto del usuario", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({
        photoUrl: "https://s3.amazonaws.com/bucket/profile-photos/u1.jpg",
      }),
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);

    expect(getByTestId("profile-photo-picker")).toBeTruthy();
    expect(getByTestId("profile-photo-picker-avatar")).toBeTruthy();
  });
});

