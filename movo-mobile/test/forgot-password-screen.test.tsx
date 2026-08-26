import { ApiError } from "@movo/shared/dist/errors/api-error";
import { act, fireEvent, render } from "@testing-library/react-native";
import ForgotPasswordScreen from "../app/(auth)/forgot-password";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args), canGoBack: () => true },
}));

const mockForgotPassword = jest.fn();
const mockVerifyResetOtp = jest.fn();
const mockResendOtp = jest.fn();
const mockResetPassword = jest.fn();
jest.mock("../src/api/auth-client", () => ({
  authClient: {
    forgotPassword: (identifier: string) => mockForgotPassword(identifier),
    verifyResetOtp: (otpId: string, code: string) => mockVerifyResetOtp(otpId, code),
    resendOtp: (otpId: string) => mockResendOtp(otpId),
    resetPassword: (token: string, newPassword: string) => mockResetPassword(token, newPassword),
  },
}));

async function press(el: unknown) {
  await act(async () => {
    fireEvent.press(el as never);
    await Promise.resolve();
  });
}

async function typeIn(el: unknown, value: string) {
  await act(async () => {
    fireEvent.changeText(el as never, value);
    await Promise.resolve();
  });
}

/** Lleva la pantalla del paso 0 al paso de OTP con un identificador cualquiera. */
async function reachOtpStep(screen: ReturnType<typeof render> extends Promise<infer R> ? R : never, identifier = "3511234567") {
  await typeIn(screen.getByTestId("forgot-password-identifier"), identifier);
  await press(screen.getByTestId("forgot-password-request"));
}

/** Lleva la pantalla del paso de OTP al paso de contraseña nueva. */
async function reachPasswordStep(screen: ReturnType<typeof render> extends Promise<infer R> ? R : never) {
  await reachOtpStep(screen);
  await typeIn(screen.getByTestId("forgot-password-otp-input-0"), "123456");
  await press(screen.getByTestId("forgot-password-verify"));
}

describe("ForgotPasswordScreen (MOVO-141)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockForgotPassword.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, channel: "sms" });
    mockVerifyResetOtp.mockResolvedValue({ passwordResetToken: "reset-token-1" });
    mockResendOtp.mockResolvedValue({ resentAt: "now", cooldownSeconds: 60 });
    mockResetPassword.mockResolvedValue(undefined);
  });

  it("no manda nada hasta que el identificador no está vacío", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await press(screen.getByTestId("forgot-password-request"));
    expect(mockForgotPassword).not.toHaveBeenCalled();
  });

  it("pide el código y pasa al paso de OTP", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen, "marina@example.com");

    expect(mockForgotPassword).toHaveBeenCalledWith("marina@example.com");
    expect(screen.getByTestId("forgot-password-otp-input-0")).toBeTruthy();
  });

  it("el copy y el autofill del paso de OTP dependen del canal (sms)", async () => {
    mockForgotPassword.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, channel: "sms" });
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen);

    expect(screen.getByText(/por SMS/)).toBeTruthy();
    expect(screen.getByTestId("forgot-password-otp-input-0").props.autoComplete).toBe("sms-otp");
  });

  it("el copy y el autofill del paso de OTP dependen del canal (email)", async () => {
    mockForgotPassword.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, channel: "email" });
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen, "marina@example.com");

    expect(screen.getByText(/a tu email/)).toBeTruthy();
    expect(screen.getByTestId("forgot-password-otp-input-0").props.autoComplete).toBe("off");
  });

  it("el copy nunca afirma que la cuenta existe", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen);

    expect(screen.queryByText(/te enviamos un código a tu cuenta/i)).toBeNull();
    expect(screen.getByText(/si el dato corresponde a una cuenta de/i)).toBeTruthy();
  });

  it("el reenvío queda bloqueado por el cooldown y muestra el contador", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen);

    expect(screen.getByTestId("forgot-password-otp-resend-cooldown")).toBeTruthy();
    expect(screen.queryByTestId("forgot-password-otp-resend")).toBeNull();
    expect(mockResendOtp).not.toHaveBeenCalled();
  });

  it("un código incorrecto limpia el input y deja reintentar en el mismo paso", async () => {
    mockVerifyResetOtp.mockRejectedValue(new ApiError(401, "AUTH_OTP_INVALID", "malo"));
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen);
    await typeIn(screen.getByTestId("forgot-password-otp-input-0"), "000000");
    await press(screen.getByTestId("forgot-password-verify"));

    expect(screen.getByTestId("forgot-password-otp-input-0").props.value).toBe("");
    expect(screen.getByTestId("forgot-password-otp-input-0")).toBeTruthy();
  });

  it("un código vencido vuelve al paso de ingreso del identificador", async () => {
    mockVerifyResetOtp.mockRejectedValue(new ApiError(422, "AUTH_OTP_EXPIRED", "vencido"));
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen);
    await typeIn(screen.getByTestId("forgot-password-otp-input-0"), "123456");
    await press(screen.getByTestId("forgot-password-verify"));

    expect(screen.getByTestId("forgot-password-identifier")).toBeTruthy();
    expect(screen.getByText("El código venció. Pedí uno nuevo.")).toBeTruthy();
  });

  it("verifica el código y pasa al paso de contraseña nueva", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await reachPasswordStep(screen);

    expect(mockVerifyResetOtp).toHaveBeenCalledWith("otp-1", "123456");
    expect(screen.getByTestId("forgot-password-new-password")).toBeTruthy();
  });

  it("no habilita el envío si las contraseñas no coinciden", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await reachPasswordStep(screen);

    await typeIn(screen.getByTestId("forgot-password-new-password"), "Password1");
    await typeIn(screen.getByTestId("forgot-password-confirm-password"), "Password2");
    await press(screen.getByTestId("forgot-password-submit"));

    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("completa el cambio y navega al login sin dejar sesión iniciada", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await reachPasswordStep(screen);

    await typeIn(screen.getByTestId("forgot-password-new-password"), "Password1");
    await typeIn(screen.getByTestId("forgot-password-confirm-password"), "Password1");
    await press(screen.getByTestId("forgot-password-submit"));

    expect(mockResetPassword).toHaveBeenCalledWith("reset-token-1", "Password1");
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/login", params: { passwordReset: "1" } });
  });

  it("un passwordResetToken vencido/usado ofrece reiniciar el wizard desde el paso 1", async () => {
    mockResetPassword.mockRejectedValue(new ApiError(401, "AUTH_OTP_INVALID", "vencido"));
    const screen = await render(<ForgotPasswordScreen />);
    await reachPasswordStep(screen);

    await typeIn(screen.getByTestId("forgot-password-new-password"), "Password1");
    await typeIn(screen.getByTestId("forgot-password-confirm-password"), "Password1");
    await press(screen.getByTestId("forgot-password-submit"));

    expect(mockReplace).not.toHaveBeenCalled();
    const restartButton = screen.getByTestId("forgot-password-restart");
    expect(restartButton).toBeTruthy();

    await press(restartButton);
    expect(screen.getByTestId("forgot-password-identifier")).toBeTruthy();
  });

  it("el back del paso de OTP vuelve al paso de identificador sin salir de la pantalla", async () => {
    const screen = await render(<ForgotPasswordScreen />);
    await reachOtpStep(screen);
    await press(screen.getByTestId("forgot-password-back"));

    expect(screen.getByTestId("forgot-password-identifier")).toBeTruthy();
  });
});
