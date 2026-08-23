import { ApiError } from "@movo/shared/dist/errors/api-error";
import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { act, fireEvent, render } from "@testing-library/react-native";
import ChangePhoneScreen from "../app/(app)/profile/change-phone";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const mockResendOtp = jest.fn();
jest.mock("../src/api/auth-client", () => ({
  authClient: { resendOtp: (otpId: string) => mockResendOtp(otpId) },
}));

const mockRequest = jest.fn();
const mockVerify = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => ({ data: mockProfile }),
  useRequestPhoneChange: () => ({ mutateAsync: mockRequest, isPending: false }),
  useVerifyPhoneChange: () => ({ mutateAsync: mockVerify, isPending: false }),
}));

let mockProfile: PrivateProfile;

function baseProfile(): PrivateProfile {
  return {
    id: "user-1",
    firstName: "Martina",
    lastName: "Zurita",
    fullName: "Martina Zurita",
    email: "martina@gmail.com",
    phone: "+5493511234567",
    dni: "35123456",
    phoneVerified: true,
    photoUrl: null,
    kycStatus: KycStatus.APPROVED,
    licenseKycStatus: KycStatus.NOT_STARTED,
    accountStatus: "active" as never,
    roles: [UserRole.SENDER],
    badges: [],
    transactionCounts: { asSender: 0, asCarrier: 0 },
    reputationScore: null,
  };
}

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

/** Lleva la pantalla del paso 1 al paso 2 con un número válido. */
async function reachOtpStep(screen: ReturnType<typeof render> extends Promise<infer R> ? R : never) {
  await typeIn(screen.getByTestId("change-phone-input"), "3511234567");
  await press(screen.getByTestId("change-phone-request"));
}

describe("ChangePhoneScreen (MOVO-135)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile = baseProfile();
    mockRequest.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, sent: true });
    mockVerify.mockResolvedValue(baseProfile());
    mockResendOtp.mockResolvedValue({ resentAt: "now", cooldownSeconds: 60 });
  });

  it("AC4: no pide el cambio hasta que el número es válido", async () => {
    const screen = await render(<ChangePhoneScreen />);
    await typeIn(screen.getByTestId("change-phone-input"), "351");
    await press(screen.getByTestId("change-phone-request"));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("AC4: manda el OTP al número NUEVO en E.164 y pasa al paso de código", async () => {
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);

    expect(mockRequest).toHaveBeenCalledWith("+5493511234567");
    expect(screen.getByTestId("change-phone-otp-input-0")).toBeTruthy();
    // Sin completar el OTP nada se persiste todavía.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("AC4: verifica el código y confirma el cambio", async () => {
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);
    await typeIn(screen.getByTestId("change-phone-otp-input-0"), "123456");
    await press(screen.getByTestId("change-phone-verify"));

    expect(mockVerify).toHaveBeenCalledWith({ otpId: "otp-1", code: "123456" });
  });

  it("AC6: el reenvío queda bloqueado por el cooldown y muestra el contador", async () => {
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);

    expect(screen.getByTestId("change-phone-otp-resend-cooldown")).toBeTruthy();
    expect(screen.queryByTestId("change-phone-otp-resend")).toBeNull();
    expect(mockResendOtp).not.toHaveBeenCalled();
  });

  it("reusa el OTP activo sin prometer un SMS nuevo cuando sent es false", async () => {
    mockRequest.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 42, sent: false });
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);

    expect(screen.getByText(/sigue siendo válido/)).toBeTruthy();
  });

  it("AC7: un teléfono de otra cuenta muestra el mensaje y deja la pantalla usable", async () => {
    mockRequest.mockRejectedValue(
      new ApiError(409, "PHONE_ALREADY_IN_USE", "en uso"),
    );
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);

    expect(screen.getByText("Ese teléfono ya está asociado a otra cuenta.")).toBeTruthy();
    // Sigue en el paso 1, con el campo disponible para corregir.
    expect(screen.getByTestId("change-phone-input")).toBeTruthy();
  });

  it("un código incorrecto limpia el input y deja reintentar en el mismo paso", async () => {
    mockVerify.mockRejectedValue(new ApiError(401, "AUTH_OTP_INVALID", "malo"));
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);
    await typeIn(screen.getByTestId("change-phone-otp-input-0"), "000000");
    await press(screen.getByTestId("change-phone-verify"));

    expect(screen.getByTestId("change-phone-otp-input-0").props.value).toBe("");
    expect(screen.getByTestId("change-phone-otp-input-0")).toBeTruthy();
  });

  // Un código vencido no se arregla tipeando de nuevo: hace falta pedir uno nuevo,
  // así que la pantalla vuelve al paso 1 en vez de dejar reintentar en vano.
  it("un código vencido devuelve al paso de ingreso del número", async () => {
    mockVerify.mockRejectedValue(new ApiError(422, "AUTH_OTP_EXPIRED", "vencido"));
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);
    await typeIn(screen.getByTestId("change-phone-otp-input-0"), "123456");
    await press(screen.getByTestId("change-phone-verify"));

    expect(screen.getByTestId("change-phone-input")).toBeTruthy();
    expect(screen.getByText("El código venció. Pedí uno nuevo.")).toBeTruthy();
  });

  it("el back del paso de código vuelve al paso 1 sin salir de la pantalla", async () => {
    const screen = await render(<ChangePhoneScreen />);
    await reachOtpStep(screen);
    await press(screen.getByTestId("change-phone-back"));

    expect(screen.getByTestId("change-phone-input")).toBeTruthy();
  });
});
