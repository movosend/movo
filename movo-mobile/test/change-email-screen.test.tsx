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
    emailVerified: true,
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

describe("ChangeEmailScreen (MOVO-135)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile = baseProfile();
    mockRequest.mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, sent: true });
    mockVerify.mockResolvedValue(baseProfile());
  });

  // AC5 (MOVO-139): el código va al email NUEVO, no al teléfono — prueba de
  // propiedad directa de la dirección que se está por confirmar.
  it("AC5: avisa antes de enviar que el código va a la dirección nueva", async () => {
    const screen = await render(<ChangeEmailScreen />);

    expect(screen.getByText(/Te vamos a mandar un código a esa dirección/)).toBeTruthy();
    expect(screen.getByText("martina@gmail.com")).toBeTruthy();
  });

  it("AC5: el paso del código nombra el email nuevo al que se envió", async () => {
    const screen = await render(<ChangeEmailScreen />);
    await typeIn(screen.getByTestId("change-email-input"), "nuevo@gmail.com");
    await press(screen.getByTestId("change-email-request"));

    expect(mockRequest).toHaveBeenCalledWith("nuevo@gmail.com");
    expect(screen.getByText(/Te enviamos un código de 6 dígitos a/)).toBeTruthy();
    expect(screen.getByText("nuevo@gmail.com")).toBeTruthy();
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
