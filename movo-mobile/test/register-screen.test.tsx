import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import RegisterScreen from "../app/(auth)/register";
import { RegistrationProvider } from "../src/hooks/use-registration";
import { authClient } from "../src/api/auth-client";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/api/auth-client", () => ({
  authClient: {
    register: jest.fn(),
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    createKycSession: jest.fn(),
    getKycStatus: jest.fn(),
  },
}));

async function press(el: unknown) {
  await act(async () => {
    fireEvent.press(el as never);
    await Promise.resolve();
  });
}

async function renderScreen() {
  const screen = await render(
    <RegistrationProvider>
      <RegisterScreen />
    </RegistrationProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("register-email")).toBeTruthy());
  return screen;
}

/**
 * Registro simplificado: 4 pasos (email y teléfono, código SMS, contraseña, revisión). No pide
 * nombre, DNI ni dirección: el nombre legal y el DNI los completa Didit al aprobar el KYC.
 */
describe("RegisterScreen (registro de 4 pasos)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("el primer paso pide solo email y teléfono", async () => {
    const screen = await renderScreen();

    expect(screen.getByTestId("register-email")).toBeTruthy();
    expect(screen.getByTestId("register-phone")).toBeTruthy();
    expect(screen.getByText("Paso 1")).toBeTruthy();
    for (const removed of ["register-first-name", "register-last-name", "register-dni", "register-street", "register-province", "register-map"]) {
      expect(screen.queryByTestId(removed)).toBeNull();
    }
  });

  it("con datos inválidos no avanza ni manda el código", async () => {
    const screen = await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId("register-email"), "mal");
    });
    await press(screen.getByTestId("register-primary-action"));

    expect(authClient.sendOtp).not.toHaveBeenCalled();
    expect(screen.getByText("Ingresá un email válido")).toBeTruthy();
    expect(screen.getByText("Paso 1")).toBeTruthy();
  });

  it("con email y teléfono válidos manda el código y pasa directo a verificar el teléfono", async () => {
    (authClient.sendOtp as jest.Mock).mockResolvedValue({ otpId: "otp_1", cooldownSeconds: 60 });
    const screen = await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId("register-email"), "julia@mail.com");
      fireEvent.changeText(screen.getByTestId("register-phone"), "3512345678");
    });
    await press(screen.getByTestId("register-primary-action"));

    await waitFor(() => expect(authClient.sendOtp).toHaveBeenCalledWith("+5493512345678"));
    await waitFor(() => expect(screen.getByText("Verificá tu teléfono")).toBeTruthy());
    expect(screen.getByText("Paso 2")).toBeTruthy();
    // Antes de la verificación seguía la dirección: ya no.
    expect(screen.queryByText("Dirección de tu casa")).toBeNull();
  });
});
