import { render, fireEvent, within, waitFor } from "@testing-library/react-native";
import { KycStatus } from "@movo/shared/dist/types/user";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router } from "expo-router";
import LicenseKycScreen from "../app/(app)/license-kyc";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn() },
}));

const mockStartVerification = jest.fn();
jest.mock("@didit-protocol/sdk-react-native", () => ({
  startVerification: (...args: unknown[]) => mockStartVerification(...args),
  VerificationStatus: { Approved: "Approved", Pending: "Pending", Declined: "Declined" },
}));

const mockCreateLicenseKycSession = jest.fn();
const mockGetLicenseKycStatus = jest.fn();
jest.mock("../src/api/auth-client", () => ({
  authClient: {
    createLicenseKycSession: (...args: unknown[]) => mockCreateLicenseKycSession(...args),
    getLicenseKycStatus: (...args: unknown[]) => mockGetLicenseKycStatus(...args),
  },
}));

// MOVO-15: mismo mecanismo de KYC que kyc.tsx (identidad, ver test/kyc.test.tsx), pero
// desacoplado de useRegistration() — el estado del flujo vive en el propio componente
// y las llamadas van directo a authClient (sin accessToken explícito, el interceptor
// lo adjunta desde la sesión real).
describe("LicenseKycScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: sin resultado previo (equivalente a not_started/404) — la pantalla se
    // queda en la intro salvo que un test pise este mock.
    mockGetLicenseKycStatus.mockRejectedValue(new ApiError(404, "NOT_FOUND", "not found"));
  });

  it("inicia la verificación y muestra la pantalla de aprobado", async () => {
    mockCreateLicenseKycSession.mockResolvedValue({ sessionId: "s1", sessionToken: "tok_1" });
    mockStartVerification.mockResolvedValue({
      type: "completed",
      session: { sessionId: "s1", status: "Approved" },
    });

    const { getByTestId, findByTestId } = await render(<LicenseKycScreen />);
    await fireEvent.press(getByTestId("license-kyc-begin-verification"));

    const title = await findByTestId("license-kyc-result-title");
    expect(title.props.children).toMatch(/verificada/i);
  });

  it("mapea cameraAccessDenied a la pantalla de error con opción de reintentar", async () => {
    mockCreateLicenseKycSession.mockResolvedValue({ sessionId: "s1", sessionToken: "tok_1" });
    mockStartVerification.mockResolvedValue({
      type: "failed",
      error: { type: "cameraAccessDenied", message: "denied" },
    });

    const { getByTestId, findByTestId } = await render(<LicenseKycScreen />);
    await fireEvent.press(getByTestId("license-kyc-begin-verification"));

    const title = await findByTestId("license-kyc-result-title");
    expect(title.props.children).toMatch(/cámara/i);
    expect(within(getByTestId("license-kyc-primary-action")).getByText(/reintentar/i)).toBeTruthy();
  });

  it("un status de licencia MANUAL_REVIEW resumido al entrar salta directo al resultado sin invocar el SDK", async () => {
    mockGetLicenseKycStatus.mockResolvedValue({ status: KycStatus.MANUAL_REVIEW, manualReviewReason: null });

    const { findByTestId } = await render(<LicenseKycScreen />);

    const title = await findByTestId("license-kyc-result-title");
    expect(title.props.children).toMatch(/revisión/i);
    expect(mockStartVerification).not.toHaveBeenCalled();
  });

  it("PENDING resumido no muestra 'en revisión' y permite reintentar creando una sesión nueva", async () => {
    mockGetLicenseKycStatus.mockResolvedValue({ status: KycStatus.PENDING, manualReviewReason: null });
    mockCreateLicenseKycSession.mockResolvedValue({ sessionId: "s2", sessionToken: "tok_2" });
    mockStartVerification.mockResolvedValue({
      type: "completed",
      session: { sessionId: "s2", status: "Approved" },
    });

    const { findByTestId, getByTestId } = await render(<LicenseKycScreen />);

    const title = await findByTestId("license-kyc-result-title");
    expect(title.props.children).toMatch(/a medias/i);
    expect(mockStartVerification).not.toHaveBeenCalled();

    const primaryAction = getByTestId("license-kyc-primary-action");
    expect(within(primaryAction).getByText(/reintentar/i)).toBeTruthy();

    await fireEvent.press(primaryAction);
    expect(mockCreateLicenseKycSession).toHaveBeenCalled();
    await waitFor(() => expect(mockStartVerification).toHaveBeenCalledWith("tok_2", expect.anything()));
  });

  it("un status que el SDK no debería devolver cae en 'interrumpida', no en la intro", async () => {
    mockCreateLicenseKycSession.mockResolvedValue({ sessionId: "s3", sessionToken: "tok_3" });
    mockStartVerification.mockResolvedValue({
      type: "completed",
      session: { sessionId: "s3", status: "In Review" },
    });

    const { getByTestId, findByTestId, queryByTestId } = await render(<LicenseKycScreen />);
    await fireEvent.press(getByTestId("license-kyc-begin-verification"));

    const title = await findByTestId("license-kyc-result-title");
    expect(title.props.children).toMatch(/interrumpida/i);
    expect(queryByTestId("license-kyc-begin-verification")).toBeNull();
  });

  it("PENDING ofrece además consultar el estado, sin crear una sesión nueva", async () => {
    mockGetLicenseKycStatus.mockResolvedValueOnce({ status: KycStatus.PENDING, manualReviewReason: null });
    const { findByTestId } = await render(<LicenseKycScreen />);
    await findByTestId("license-kyc-result-title");

    mockGetLicenseKycStatus.mockResolvedValueOnce({ status: KycStatus.PENDING, manualReviewReason: null });
    await fireEvent.press(await findByTestId("license-kyc-refresh-status"));

    expect(mockCreateLicenseKycSession).not.toHaveBeenCalled();
  });

  it("'Ir al inicio' siempre va a /home (esta pantalla solo es alcanzable con sesión autenticada real)", async () => {
    mockGetLicenseKycStatus.mockResolvedValue({ status: KycStatus.MANUAL_REVIEW, manualReviewReason: null });

    const { findByTestId } = await render(<LicenseKycScreen />);
    await fireEvent.press(await findByTestId("license-kyc-primary-action"));

    expect(router.replace).toHaveBeenCalledWith("/home");
  });

  // error-messages.ts#CODE_MESSAGES mapea KYC_SESSION_NOT_ALLOWED a "Tu identidad ya
  // está verificada." (correcto para el flujo de identidad) — acá se resuelve a mano
  // para no mostrar ese texto incorrecto sobre una licencia.
  it("KYC_SESSION_NOT_ALLOWED muestra 'Tu licencia ya está verificada', no el mensaje de identidad", async () => {
    mockCreateLicenseKycSession.mockRejectedValue(
      new ApiError(409, "KYC_SESSION_NOT_ALLOWED", "El estado de verificación actual no permite crear una nueva sesión.")
    );

    const { getByTestId, findByTestId } = await render(<LicenseKycScreen />);
    await fireEvent.press(getByTestId("license-kyc-begin-verification"));

    const banner = await findByTestId("license-kyc-error-banner");
    expect(within(banner).getByText("Tu licencia ya está verificada.")).toBeTruthy();
    expect(mockStartVerification).not.toHaveBeenCalled();
  });
});
