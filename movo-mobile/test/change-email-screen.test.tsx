import { ApiError } from "@movo/shared/dist/errors/api-error";
import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { act, fireEvent, render } from "@testing-library/react-native";
import ChangeEmailScreen from "../app/(app)/profile/change-email";

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
  useRequestEmailChange: () => ({ mutateAsync: mockRequest, isPending: false }),
  useVerifyEmailChange: () => ({ mutateAsync: mockVerify, isPending: false }),
}));

let mockProfile: PrivateProfile;

function baseProfile(): PrivateProfile {
  return {
    id: "user-1",
    firstName: "Martina",
    lastName: "Zurita",
    fullName: "Martina Zurita",
    email: "martina@gmail.com",
    // Buenos Aires: `formatPhoneDisplay` lo muestra como "+54 9 11 4023-8871".
    phone: "+5491140238871",
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

describe("ChangeEmailScreen (MOVO-135)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile = baseProfile();
    mockRequest.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, sent: true });
    mockVerify.mockResolvedValue(baseProfile());
  });

  // AC5: el código va al teléfono actual, NO al email nuevo (no hay EmailProvider en
  // el proyecto). Si la pantalla no lo dice, recibir un SMS al cambiar el email es
  // desconcertante — por eso se avisa antes de pedirlo y de nuevo al pedirlo.
  it("AC5: avisa antes de enviar que el código va por SMS al teléfono actual", async () => {
    const screen = await render(<ChangeEmailScreen />);

    expect(screen.getByTestId("change-email-sms-notice")).toBeTruthy();
    expect(screen.getByText("+54 9 11 4023-8871")).toBeTruthy();
  });

  it("AC5: el paso del código nombra el teléfono al que se envió", async () => {
    const screen = await render(<ChangeEmailScreen />);
    await typeIn(screen.getByTestId("change-email-input"), "nuevo@gmail.com");
    await press(screen.getByTestId("change-email-request"));

    expect(mockRequest).toHaveBeenCalledWith("nuevo@gmail.com");
    expect(screen.getByText(/por SMS a tu teléfono actual/)).toBeTruthy();
    expect(screen.getByText("+54 9 11 4023-8871")).toBeTruthy();
  });

  it("no pide el cambio con un email inválido", async () => {
    const screen = await render(<ChangeEmailScreen />);
    await typeIn(screen.getByTestId("change-email-input"), "no-es-un-email");
    await press(screen.getByTestId("change-email-request"));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("verifica el código y confirma el cambio", async () => {
    const screen = await render(<ChangeEmailScreen />);
    await typeIn(screen.getByTestId("change-email-input"), "nuevo@gmail.com");
    await press(screen.getByTestId("change-email-request"));
    await typeIn(screen.getByTestId("change-email-otp-input-0"), "123456");
    await press(screen.getByTestId("change-email-verify"));

    expect(mockVerify).toHaveBeenCalledWith({ otpId: "otp-1", code: "123456" });
  });

  it("AC7: un email de otra cuenta muestra el mensaje sin romper la pantalla", async () => {
    mockRequest.mockRejectedValue(new ApiError(409, "EMAIL_ALREADY_IN_USE", "en uso"));
    const screen = await render(<ChangeEmailScreen />);
    await typeIn(screen.getByTestId("change-email-input"), "ocupado@gmail.com");
    await press(screen.getByTestId("change-email-request"));

    expect(screen.getByText("Ese email ya está asociado a otra cuenta.")).toBeTruthy();
    expect(screen.getByTestId("change-email-input")).toBeTruthy();
  });
});
