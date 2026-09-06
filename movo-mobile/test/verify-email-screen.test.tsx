import { ApiError } from "@movo/shared/dist/errors/api-error";
import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import VerifyEmailScreen from "../app/(app)/profile/verify-email";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

jest.mock("../src/api/auth-client", () => ({
  authClient: { resendOtp: jest.fn().mockResolvedValue({ resentAt: "now", cooldownSeconds: 60 }) },
}));

const mockRequest = jest.fn();
const mockVerify = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => ({ data: mockProfile }),
  useRequestEmailVerification: () => ({ mutateAsync: mockRequest, isPending: false }),
  useVerifyEmailVerification: () => ({ mutateAsync: mockVerify, isPending: false }),
}));

let mockProfile: PrivateProfile;

function baseProfile(): PrivateProfile {
  return {
    id: "user-1",
    firstName: "Martina",
    lastName: "Zurita",
    fullName: "Martina Zurita",
    email: "martina@gmail.com",
    phone: "+5491140238871",
    dni: "35123456",
    phoneVerified: true,
    emailVerified: false,
    photoUrl: null,
    kycStatus: KycStatus.APPROVED,
    licenseKycStatus: KycStatus.NOT_STARTED,
    accountStatus: "active" as never,
    roles: [UserRole.SENDER],
    badges: [],
    transactionCounts: { asSender: 0, asCarrier: 0 },
    reputationScore: null,
    bio: null,
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

describe("VerifyEmailScreen (MOVO-139)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile = baseProfile();
    mockRequest.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, sent: true });
    mockVerify.mockResolvedValue(baseProfile());
  });

  it("no pide ningún dato: el intro ya nombra el email actual y solo pide enviar el código", async () => {
    const screen = await render(<VerifyEmailScreen />);

    expect(screen.getByText(/Te vamos a mandar un código a/)).toBeTruthy();
    expect(screen.getByText("martina@gmail.com")).toBeTruthy();
    expect(screen.getByTestId("verify-email-request")).toBeTruthy();
  });

  it("al enviar, pide el OTP sin ningún body y pasa al paso del código", async () => {
    const screen = await render(<VerifyEmailScreen />);
    await press(screen.getByTestId("verify-email-request"));

    expect(mockRequest).toHaveBeenCalledWith();
    expect(screen.getByTestId("verify-email-otp-input-0")).toBeTruthy();
  });

  it("verifica el código y vuelve atrás", async () => {
    const screen = await render(<VerifyEmailScreen />);
    await press(screen.getByTestId("verify-email-request"));
    await typeIn(screen.getByTestId("verify-email-otp-input-0"), "123456");
    await press(screen.getByTestId("verify-email-verify"));

    expect(mockVerify).toHaveBeenCalledWith({ otpId: "otp-1", code: "123456" });
    expect(router.back).toHaveBeenCalled();
  });

  it("un código vencido vuelve al paso inicial", async () => {
    mockVerify.mockRejectedValue(new ApiError(422, "AUTH_OTP_EXPIRED", "vencido"));
    const screen = await render(<VerifyEmailScreen />);
    await press(screen.getByTestId("verify-email-request"));
    await typeIn(screen.getByTestId("verify-email-otp-input-0"), "123456");
    await press(screen.getByTestId("verify-email-verify"));

    expect(screen.getByTestId("verify-email-request")).toBeTruthy();
    expect(screen.getByText("El código venció. Pedí uno nuevo.")).toBeTruthy();
  });

  it("un email ya verificado (400) muestra el mensaje sin romper la pantalla", async () => {
    mockRequest.mockRejectedValue(new ApiError(400, "VALIDATION_FAILED", "ya verificado"));
    const screen = await render(<VerifyEmailScreen />);
    await press(screen.getByTestId("verify-email-request"));

    expect(
      screen.getByText("Revisá los datos ingresados, hay algo que no es válido."),
    ).toBeTruthy();
  });
});
