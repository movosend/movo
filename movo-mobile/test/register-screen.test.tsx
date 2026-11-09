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

  describe("barra de progreso", () => {
    async function advanceToPassword(screen: Awaited<ReturnType<typeof renderScreen>>) {
      (authClient.sendOtp as jest.Mock).mockResolvedValue({ otpId: "otp_1", cooldownSeconds: 60 });
      (authClient.verifyOtp as jest.Mock).mockResolvedValue({
        phoneVerificationToken: "tok_abc",
        phoneVerifiedAt: "2026-01-01T00:00:00.000Z",
      });
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("register-email"), "julia@mail.com");
        fireEvent.changeText(screen.getByTestId("register-phone"), "3512345678");
      });
      await press(screen.getByTestId("register-primary-action"));
      await waitFor(() => expect(screen.getByText("Verificá tu teléfono")).toBeTruthy());
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("register-otp-input-0"), "123456");
      });
      await press(screen.getByTestId("register-primary-action"));
      await waitFor(() => expect(screen.getByText("Creá tu contraseña")).toBeTruthy());
    }

    it("con el código SMS de por medio, la contraseña es el paso 3", async () => {
      const screen = await renderScreen();
      await advanceToPassword(screen);

      expect(screen.getByText("Paso 3")).toBeTruthy();
    });

    it("con el teléfono ya verificado, el paso del código se saltea y deja de contar", async () => {
      const screen = await renderScreen();
      await advanceToPassword(screen);

      // Volver desde la contraseña se salta el código y cae en el paso 1.
      await press(screen.getByTestId("register-back"));
      await waitFor(() => expect(screen.getByTestId("register-email")).toBeTruthy());
      expect(screen.getByText("Paso 1")).toBeTruthy();

      // Seguir sin cambiar el teléfono: no se manda otro SMS y la contraseña es el paso 2.
      (authClient.sendOtp as jest.Mock).mockClear();
      await press(screen.getByTestId("register-primary-action"));
      await waitFor(() => expect(screen.getByText("Creá tu contraseña")).toBeTruthy());
      expect(authClient.sendOtp).not.toHaveBeenCalled();
      expect(screen.getByText("Paso 2")).toBeTruthy();
    });
  });
});
