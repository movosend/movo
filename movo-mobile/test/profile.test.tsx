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
const mockUsePublicProfile = jest.fn();
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
  usePublicProfile: () => mockUsePublicProfile(),
}));

function baseProfile(overrides: Partial<PrivateProfile> = {}): PrivateProfile {
  return {
    id: "user-1",
    firstName: "Martina",
    lastName: "Zurita",
    fullName: "Martina Zurita",
    email: "martina.zurita@gmail.com",
    // MOVO-139: el backend ya devuelve este campo; la insignia/CTA de email verificado
    // en la pantalla de perfil es alcance de MOVO-135.
    emailVerified: false,
    phone: "+5491140238871",
    dni: "35123456",
    phoneVerified: true,
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
    bio: null,
    ...overrides,
  };
}

// MOVO-78: pantalla de perfil propio — loading/error/estados de KYC/logout.
describe("ProfileScreen", () => {
  afterEach(() => jest.clearAllMocks());

  beforeEach(() => {
    // Desglose de reputación (MOVO-154) — degrada a "sin sección" en los tests que no
    // lo ejercitan explícitamente, mismo criterio que la pantalla real ante un fallo.
    mockUsePublicProfile.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

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
    const activityCard = getByTestId("profile-activity-card");

    expect(within(activityCard).getByText("Sin envíos aún")).toBeTruthy();
    expect(within(activityCard).getByText("Sin viajes aún")).toBeTruthy();
    expect(within(activityCard).getByText("Sin calificaciones")).toBeTruthy();
    expect(queryByText("0")).toBeNull();
    expect(queryByText("null")).toBeNull();
    expect(queryByText("NaN")).toBeNull();
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
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/license-kyc",
      params: { status: KycStatus.MANUAL_REVIEW },
    });
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

  // MOVO-135: la foto acá es de solo lectura. Editarla (y ver email/teléfono) vive
  // únicamente en "Editar perfil" — tenerlo en las dos pantallas duplicaba la misma
  // información y dos puntos de entrada para la misma acción.
  it("muestra el avatar de solo lectura, sin control de edición de foto", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({
        photoUrl: "https://s3.amazonaws.com/bucket/profile-photos/u1.jpg",
      }),
      refetch: mockRefetch,
    });

    const { getByTestId, queryByTestId } = await render(<ProfileScreen />);

    expect(getByTestId("profile-avatar")).toBeTruthy();
    expect(queryByTestId("profile-photo-picker")).toBeNull();
    expect(queryByTestId("profile-private-section")).toBeNull();
  });

  it("AC1 de MOVO-135: el botón de editar lleva a la pantalla de editar perfil", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile(),
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);
    fireEvent.press(getByTestId("profile-edit-button"));

    expect(router.push).toHaveBeenCalledWith("/profile/edit");
  });

  it("muestra insignias 'DNI' y 'Licencia' debajo del nombre en verde cuando están verificadas", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({
        kycStatus: KycStatus.APPROVED,
        licenseKycStatus: KycStatus.APPROVED,
        badges: ["kyc_verified", "license_verified"],
      }),
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);
    const badgesContainer = getByTestId("profile-badges");

    const dniText = within(badgesContainer).getByText("DNI");
    const licenseText = within(badgesContainer).getByText("Licencia");
    expect(dniText.props.className).toContain("text-success-600");
    expect(licenseText.props.className).toContain("text-success-600");
  });

  it("muestra insignias en rojo cuando los documentos no están verificados", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({
        kycStatus: KycStatus.NOT_STARTED,
        licenseKycStatus: KycStatus.NOT_STARTED,
        badges: [],
      }),
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<ProfileScreen />);
    const badgesContainer = getByTestId("profile-badges");

    const dniText = within(badgesContainer).getByText("DNI");
    const licenseText = within(badgesContainer).getByText("Licencia");
    expect(dniText.props.className).toContain("text-danger-600");
    expect(licenseText.props.className).toContain("text-danger-600");
  });

  // MOVO-154: desglose de reputación por rol + comentarios recientes en el perfil
  // propio, alimentado por `usePublicProfile(myId)` — `PrivateProfile` no trae esos
  // campos (ver `use-profile.ts`).
  it("muestra el desglose de reputación por rol cuando el perfil público resuelve", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile({ transactionCounts: { asSender: 4, asCarrier: 2 } }),
      refetch: mockRefetch,
    });
    mockUsePublicProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        id: "user-1",
        fullName: "Martina Zurita",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 4, asCarrier: 2 },
        reputationScore: 4.7,
        ratingCount: 9,
        isNewProfile: false,
        asSender: { reputationScore: 4.5, ratingCount: 4, isNewProfile: false },
        asCarrier: { reputationScore: null, ratingCount: 2, isNewProfile: true },
        recentRatingComments: [
          { id: "r1", raterId: "u2", score: 5, comment: "Todo perfecto", createdAt: "2026-08-01T00:00:00.000Z" },
        ],
      },
    });

    const { getByText, getByTestId } = await render(<ProfileScreen />);

    expect(getByTestId("profile-activity-card-reputation")).toBeTruthy();
    expect(getByText("Como emisor")).toBeTruthy();
    expect(getByText("Como transportista")).toBeTruthy();
    expect(getByText("Perfil nuevo")).toBeTruthy();
    expect(getByText("Todo perfecto")).toBeTruthy();
  });

  it("no muestra la sección de reputación si el perfil público todavía no resolvió (degrada sin romper)", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile(),
      refetch: mockRefetch,
    });
    mockUsePublicProfile.mockReturnValue({ isLoading: true, isError: false, data: undefined });

    const { queryByTestId } = await render(<ProfileScreen />);

    expect(queryByTestId("profile-activity-card-reputation")).toBeNull();
  });

  it("'Ver todas' navega a /profile/ratings cuando hay comentarios", async () => {
    mockUseMyProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseProfile(),
      refetch: mockRefetch,
    });
    mockUsePublicProfile.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        id: "user-1",
        fullName: "Martina Zurita",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 3, asCarrier: 0 },
        reputationScore: 4.7,
        ratingCount: 9,
        isNewProfile: false,
        asSender: { reputationScore: 4.7, ratingCount: 9, isNewProfile: false },
        asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true },
        recentRatingComments: [
          { id: "r1", raterId: "u2", score: 5, comment: "Todo perfecto", createdAt: "2026-08-01T00:00:00.000Z" },
        ],
      },
    });

    const { getByTestId } = await render(<ProfileScreen />);
    fireEvent.press(getByTestId("profile-activity-card-view-all"));

    expect(router.push).toHaveBeenCalledWith("/profile/ratings");
  });
});

