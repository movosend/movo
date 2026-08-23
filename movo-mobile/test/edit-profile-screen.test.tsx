import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import EditProfileScreen from "../app/(app)/profile/edit";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
}));

const mockInvalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

// `PhotoPicker` ya tiene su propia cobertura (photo-picker.test.tsx) y hace un
// pipeline entero contra S3 — acá solo interesa que la pantalla lo monte.
jest.mock("../components/profile/photo-picker", () => {
  const { Text } = require("react-native");
  return { PhotoPicker: ({ testID }: { testID: string }) => <Text testID={testID}>foto</Text> };
});

const mockUseMyProfile = jest.fn();
const mockUpdateProfile = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  MY_PROFILE_QUERY_KEY: ["profile", "me"],
  useMyProfile: () => mockUseMyProfile(),
  useUpdateProfile: () => mockUpdateProfile(),
}));

function baseProfile(overrides: Partial<PrivateProfile> = {}): PrivateProfile {
  return {
    id: "user-1",
    firstName: "Martina",
    lastName: "Zurita",
    fullName: "Martina Zurita",
    email: "martina.zurita@gmail.com",
    phone: "+5493511234567",
    dni: "35123456",
    phoneVerified: true,
    photoUrl: null,
    kycStatus: KycStatus.NOT_STARTED,
    licenseKycStatus: KycStatus.NOT_STARTED,
    accountStatus: "active" as never,
    roles: [UserRole.SENDER],
    badges: [],
    transactionCounts: { asSender: 0, asCarrier: 0 },
    reputationScore: null,
    ...overrides,
  };
}

function mockProfileQuery(profile: PrivateProfile | null, extra: Record<string, unknown> = {}) {
  mockUseMyProfile.mockReturnValue({
    data: profile,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    ...extra,
  });
}

async function typeIn(el: unknown, value: string) {
  await act(async () => {
    fireEvent.changeText(el as never, value);
    await Promise.resolve();
  });
}

async function blur(el: unknown) {
  await act(async () => {
    fireEvent(el as never, "blur");
    await Promise.resolve();
  });
}

async function press(el: unknown) {
  await act(async () => {
    fireEvent.press(el as never);
    await Promise.resolve();
  });
}

describe("EditProfileScreen (MOVO-135)", () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mutateAsync = jest.fn().mockResolvedValue(baseProfile());
    mockUpdateProfile.mockReturnValue({ mutateAsync, isPending: false });
    mockProfileQuery(baseProfile());
  });

  it("siembra el formulario con el perfil cargado", async () => {
    const { getByTestId } = await render(<EditProfileScreen />);
    expect(getByTestId("edit-profile-first-name").props.value).toBe("Martina");
    expect(getByTestId("edit-profile-last-name").props.value).toBe("Zurita");
  });

  it("AC2: guarda al salir del campo y muestra la confirmación visual", async () => {
    const { getByTestId, queryByTestId } = await render(<EditProfileScreen />);
    expect(queryByTestId("edit-profile-success")).toBeNull();

    await typeIn(getByTestId("edit-profile-first-name"), "Martina Sol");
    await blur(getByTestId("edit-profile-first-name"));

    // Solo viaja el campo que cambió, no el formulario entero.
    expect(mutateAsync).toHaveBeenCalledWith({ firstName: "Martina Sol" });
    expect(queryByTestId("edit-profile-success")).toBeTruthy();
  });

  it("no manda nada al salir de un campo que no se tocó", async () => {
    const { getByTestId } = await render(<EditProfileScreen />);
    await blur(getByTestId("edit-profile-first-name"));
    await blur(getByTestId("edit-profile-last-name"));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("no manda un nombre vacío: muestra el error en el campo", async () => {
    const { getByTestId } = await render(<EditProfileScreen />);
    await typeIn(getByTestId("edit-profile-first-name"), "   ");
    await blur(getByTestId("edit-profile-first-name"));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(getByTestId("edit-profile-first-name-error")).toBeTruthy();
  });

  it("AC3: con KYC aprobado el nombre queda bloqueado y no hay forma de enviarlo", async () => {
    mockProfileQuery(baseProfile({ kycStatus: KycStatus.APPROVED }));
    const { getByTestId } = await render(<EditProfileScreen />);

    expect(getByTestId("edit-profile-first-name").props.editable).toBe(false);
    expect(getByTestId("edit-profile-last-name").props.editable).toBe(false);
    expect(getByTestId("edit-profile-kyc-lock-note")).toBeTruthy();

    // Ni siquiera forzando un blur con otro valor sale la request.
    await typeIn(getByTestId("edit-profile-first-name"), "Otro");
    await blur(getByTestId("edit-profile-first-name"));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("muestra el DNI como dato de solo lectura", async () => {
    const { getByTestId } = await render(<EditProfileScreen />);
    expect(getByTestId("edit-profile-dni")).toBeTruthy();
  });

  it("si el guardado falla avisa y revierte el campo al valor persistido", async () => {
    mutateAsync.mockRejectedValue(new Error("boom"));
    const { getByTestId, queryByTestId } = await render(<EditProfileScreen />);

    await typeIn(getByTestId("edit-profile-first-name"), "Otra");
    await blur(getByTestId("edit-profile-first-name"));

    expect(queryByTestId("edit-profile-error")).toBeTruthy();
    expect(queryByTestId("edit-profile-success")).toBeNull();
    // Dejar en pantalla un valor que el backend rechazó haría creer que se guardó.
    expect(getByTestId("edit-profile-first-name").props.value).toBe("Martina");
  });

  // El AC8 original ("salir con cambios sin guardar pide confirmación") dejó de
  // aplicar al pasar a guardado automático: no existe un estado "sin guardar".
  it("vuelve sin preguntar: no hay cambios sin guardar posibles", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByTestId } = await render(<EditProfileScreen />);

    await typeIn(getByTestId("edit-profile-first-name"), "Cambiado");
    await press(getByTestId("edit-profile-back"));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("teléfono y email navegan a su sub-flujo en vez de ser campos editables", async () => {
    const { getByTestId } = await render(<EditProfileScreen />);

    await press(getByTestId("edit-profile-phone-row"));
    expect(router.push).toHaveBeenCalledWith("/profile/change-phone");

    await press(getByTestId("edit-profile-email-row"));
    expect(router.push).toHaveBeenCalledWith("/profile/change-email");
  });

  // El teléfono es el único con verificación real (`phoneVerified`); el email no
  // tiene concepto de verificación en el sistema, así que no lleva insignia.
  it("muestra la insignia de verificado solo en el teléfono", async () => {
    const { getByTestId, queryAllByText } = await render(<EditProfileScreen />);

    expect(within(getByTestId("edit-profile-phone-row")).getByText("Verificado")).toBeTruthy();
    expect(
      within(getByTestId("edit-profile-email-row")).queryByText("Verificado"),
    ).toBeNull();
    expect(queryAllByText("Verificar para cambiar")).toHaveLength(0);
  });

  it("sin teléfono verificado no muestra la insignia", async () => {
    mockProfileQuery(baseProfile({ phoneVerified: false }));
    const { getByTestId } = await render(<EditProfileScreen />);

    expect(
      within(getByTestId("edit-profile-phone-row")).queryByText("Verificado"),
    ).toBeNull();
  });

  it("AC9: estado de error con reintentar", async () => {
    const refetch = jest.fn();
    mockUseMyProfile.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: null,
      refetch,
    });

    const { getByTestId } = await render(<EditProfileScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(getByTestId("edit-profile-retry"));
    expect(refetch).toHaveBeenCalled();
  });
});
