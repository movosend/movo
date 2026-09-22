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
describe("ProfileSettingsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMyProfile.mockReturnValue({ data: undefined });
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

  it("sigue mostrando el placeholder 'Próximamente' para el resto de los ítems", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Pagos y cobros"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Próximamente",
      "Estamos trabajando en esta sección.",
    );
    alertSpy.mockRestore();
  });
});
