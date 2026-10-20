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
let mockBalanceArs: number | undefined = undefined;
jest.mock("../src/hooks/use-balance", () => ({
  useBalance: () => ({ data: mockBalanceArs === undefined ? undefined : { pages: [{ balanceArs: mockBalanceArs }] } }),
}));
// MOVO-169: el sheet de "Ayuda y soporte" decide si ofrece "Cómo transportar".
jest.mock("../src/hooks/use-transport-gate", () => ({
  useTransportGate: () => ({ canBrowse: false }),
}));

describe("ProfileSettingsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMyProfile.mockReturnValue({ data: undefined });
    mockMpStatus = undefined;
    mockCards = undefined;
    mockBalanceArs = undefined;
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
    fireEvent.press(getByText("Pagos y cobros"));
    expect(router.push).toHaveBeenCalledWith("/profile/payments?tab=methods");
  });

  it("MOVO-315: con saldo pendiente avisa el monto y abre en Saldo", async () => {
    mockCards = [{ id: "c1", brand: "visa", last4: "3704", expMonth: 1, expYear: 2020, isDefault: true }];
    mockBalanceArs = 5000;
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    // La deuda gana sobre las tarjetas vencidas.
    expect(getByText("Debés $5.000")).toBeTruthy();
    fireEvent.press(getByText("Pagos y cobros"));
    expect(router.push).toHaveBeenCalledWith("/profile/payments");
  });

  it("MOVO-315: un problema de Mercado Pago gana sobre la deuda", async () => {
    mockMpStatus = { status: "invalid", account: null, invalidReason: "revoked" };
    mockBalanceArs = 5000;
    const { getByText, queryByText } = await render(<ProfileSettingsSection testID="settings" />);

    expect(getByText("Revisar")).toBeTruthy();
    expect(queryByText("Debés $5.000")).toBeNull();
  });

  it.each([
    ["sin datos todavía", undefined, undefined, undefined],
    ["Mercado Pago sin vincular y sin tarjetas", { status: "unlinked", account: null, invalidReason: null }, [], 0],
    ["todo en orden", { status: "linked", account: null, invalidReason: null }, undefined, 0],
    ["saldo a favor", { status: "linked", account: null, invalidReason: null }, undefined, -300],
  ])("sin aviso: %s", async (_case, status, cards, balance) => {
    mockMpStatus = status;
    mockCards = cards;
    mockBalanceArs = balance;
    const { queryByTestId } = await render(<ProfileSettingsSection testID="settings" />);

    expect(queryByTestId("profile-settings-payments-pill")).toBeNull();
  });

  it("MOVO-169: 'Ayuda y soporte' abre el sheet para repasar el tutorial, sin el placeholder", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByText, findByText } = await render(<ProfileSettingsSection testID="settings" />);

    await fireEvent.press(getByText("Ayuda y soporte"));

    expect(await findByText("¿Qué querés repasar?")).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
