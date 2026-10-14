import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import { LEGAL_DOCUMENT_VERSIONS } from "@movo/shared/dist/config/legal";
import { ProfileSettingsSection } from "../components/profile/profile-settings-section";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

const mockUseMyProfile = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => mockUseMyProfile(),
}));

// "Direcciones guardadas" (MOVO-121), "Cuenta y seguridad" (MOVO-136), "Legal"
// (MOVO-224) y "Notificaciones" (MOVO-246) son los ítems de esta sección con
// pantalla real — cubre que navegan en vez de mostrar el `Alert.alert` placeholder,
// y que el resto sigue mostrándolo.
let mockMpStatus: unknown = undefined;
jest.mock("../src/hooks/use-mp-connect", () => ({
  useMpConnectStatus: () => ({ data: mockMpStatus }),
}));
let mockCards: unknown = undefined;
jest.mock("../src/hooks/use-saved-cards", () => ({
  useSavedCards: () => ({ data: mockCards }),
}));

describe("ProfileSettingsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMyProfile.mockReturnValue({ data: undefined });
    mockMpStatus = undefined;
    mockCards = undefined;
  });

  it("navega a /addresses al tocar 'Direcciones guardadas'", async () => {
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Direcciones guardadas"));

    expect(router.push).toHaveBeenCalledWith("/addresses");
  });

  it("navega a /profile/security al tocar 'Cuenta y seguridad'", async () => {
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Cuenta y seguridad"));

    expect(router.push).toHaveBeenCalledWith("/profile/security");
  });

  it("navega a /profile/legal al tocar 'Legal'", async () => {
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Legal"));

    expect(router.push).toHaveBeenCalledWith("/profile/legal");
  });

  it("navega a /profile/notifications al tocar 'Notificaciones'", async () => {
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Notificaciones"));

    expect(router.push).toHaveBeenCalledWith("/profile/notifications");
  });

  it("MOVO-229: muestra el punto de 'pendiente' junto a Legal si falta aceptar algo", async () => {
    const { getByTestId } = await render(<ProfileSettingsSection testID="settings" />);

    expect(getByTestId("profile-settings-legal-pending-dot")).toBeTruthy();
  });

  it("MOVO-229: no muestra el punto de 'pendiente' si ambos documentos están al día", async () => {
    mockUseMyProfile.mockReturnValue({
      data: {
        termsAcceptedAt: "2026-09-13T12:00:00.000Z",
        termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
        privacyAcceptedAt: "2026-09-13T12:00:00.000Z",
        privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
      },
    });

    const { queryByTestId } = await render(<ProfileSettingsSection testID="settings" />);

    expect(queryByTestId("profile-settings-legal-pending-dot")).toBeNull();
  });

  it("navega a /profile/payments al tocar 'Pagos y cobros' (MOVO-112)", async () => {
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Pagos y cobros"));

    expect(router.push).toHaveBeenCalledWith("/profile/payments");
  });

  it("MOVO-112: avisa 'Revisar' si la vinculación de Mercado Pago dejó de funcionar", async () => {
    mockMpStatus = { status: "invalid", account: null, invalidReason: "revoked" };
    const { getByTestId, getByText } = await render(<ProfileSettingsSection testID="settings" />);

    expect(getByTestId("profile-settings-payments-pill")).toBeTruthy();
    expect(getByText("Revisar")).toBeTruthy();
  });

  it("MOVO-101: avisa 'Vencidas' si todas las tarjetas guardadas vencieron", async () => {
    mockMpStatus = { status: "linked", account: null, invalidReason: null };
    mockCards = [{ id: "c1", brand: "visa", last4: "3704", expMonth: 1, expYear: 2020, isDefault: true }];
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    expect(getByText("Vencidas")).toBeTruthy();
  });

  it.each([
    ["sin datos todavía", undefined, undefined],
    ["Mercado Pago sin vincular y sin tarjetas", { status: "unlinked", account: null, invalidReason: null }, []],
    ["todo en orden", { status: "linked", account: null, invalidReason: null }, undefined],
  ])("sin aviso: %s", async (_case, status, cards) => {
    mockMpStatus = status;
    mockCards = cards;
    const { queryByTestId } = await render(<ProfileSettingsSection testID="settings" />);

    expect(queryByTestId("profile-settings-payments-pill")).toBeNull();
  });

  it("sigue mostrando el placeholder 'Próximamente' para el resto de los ítems", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Ayuda y soporte"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Próximamente",
      "Estamos trabajando en esta sección.",
    );
    alertSpy.mockRestore();
  });
});
