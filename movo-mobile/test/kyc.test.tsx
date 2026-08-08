import { render, fireEvent, within } from "@testing-library/react-native";
import { KycStatus } from "@movo/shared/dist/types/user";
import KycScreen from "../app/(auth)/kyc";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn() },
}));

const mockStartVerification = jest.fn();
jest.mock("@didit-protocol/sdk-react-native", () => ({
  startVerification: (...args: unknown[]) => mockStartVerification(...args),
  VerificationStatus: { Approved: "Approved", Pending: "Pending", Declined: "Declined" },
}));

const mockCreateKycSession = jest.fn();
const mockRefreshKycStatus = jest.fn();
let mockKycStatus: KycStatus | null = null;

jest.mock("../src/hooks/use-registration", () => ({
  useRegistration: () => ({
    kycStatus: mockKycStatus,
    loading: false,
    errorBanner: null,
    createKycSession: mockCreateKycSession,
    refreshKycStatus: mockRefreshKycStatus,
  }),
}));

describe("KycScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKycStatus = null;
  });

  it("inicia la verificación y muestra la pantalla de aprobado", async () => {
    mockCreateKycSession.mockResolvedValue({ ok: true, sessionToken: "tok_1" });
    mockStartVerification.mockResolvedValue({
      type: "completed",
      session: { sessionId: "s1", status: "Approved" },
    });

    const { getByTestId, findByTestId } = await render(<KycScreen />);
    await fireEvent.press(getByTestId("kyc-begin-verification"));

    const title = await findByTestId("kyc-result-title");
    expect(title.props.children).toMatch(/aprobada/i);
    expect(mockRefreshKycStatus).toHaveBeenCalled();
  });

  it("mapea cameraAccessDenied a la pantalla de error con opción de reintentar", async () => {
    mockCreateKycSession.mockResolvedValue({ ok: true, sessionToken: "tok_1" });
    mockStartVerification.mockResolvedValue({
      type: "failed",
      error: { type: "cameraAccessDenied", message: "denied" },
    });

    const { getByTestId, findByTestId } = await render(<KycScreen />);
    await fireEvent.press(getByTestId("kyc-begin-verification"));

    const title = await findByTestId("kyc-result-title");
    expect(title.props.children).toMatch(/cámara/i);
    expect(within(getByTestId("kyc-primary-action")).getByText(/reintentar/i)).toBeTruthy();
  });

  it("si hay un kycStatus MANUAL_REVIEW resumido, salta directo a la pantalla de revisión sin volver a invocar el SDK", async () => {
    mockKycStatus = KycStatus.MANUAL_REVIEW;
    const { findByTestId } = await render(<KycScreen />);

    const title = await findByTestId("kyc-result-title");
    expect(title.props.children).toMatch(/revisión/i);
    expect(mockStartVerification).not.toHaveBeenCalled();
  });

  it("PENDING (sesión creada pero sin resolver) no muestra 'en revisión' y permite reintentar", async () => {
    mockKycStatus = KycStatus.PENDING;
    mockCreateKycSession.mockResolvedValue({ ok: true, sessionToken: "tok_2" });
    mockStartVerification.mockResolvedValue({
      type: "completed",
      session: { sessionId: "s2", status: "Approved" },
    });

    const { findByTestId, getByTestId } = await render(<KycScreen />);

    const title = await findByTestId("kyc-result-title");
    expect(title.props.children).toMatch(/a medias/i);
    expect(mockStartVerification).not.toHaveBeenCalled();

    // El backend descarta el intento anterior como `expired` y abre uno nuevo, así que
    // reintentar es la acción principal (ver ALLOWED_SESSION_SOURCE_STATUSES en
    // kyc.service.ts) — el caso típico es que el SDK nunca llegó a correr.
    const primaryAction = getByTestId("kyc-primary-action");
    expect(within(primaryAction).getByText(/reintentar/i)).toBeTruthy();

    await fireEvent.press(primaryAction);
    expect(mockCreateKycSession).toHaveBeenCalled();
    expect(mockStartVerification).toHaveBeenCalledWith("tok_2", expect.anything());
  });

  // Revisión de PR #52: el switch sobre result.session.status no tenía rama default.
  // A nivel de tipos es exhaustivo (VerificationStatus son 3 valores), pero el valor
  // llega del módulo nativo, donde el bridge lo declara `status?: string`.
  it("un status que el SDK no debería devolver cae en 'interrumpida' y no en la intro", async () => {
    mockCreateKycSession.mockResolvedValue({ ok: true, sessionToken: "tok_3" });
    mockStartVerification.mockResolvedValue({
      type: "completed",
      session: { sessionId: "s3", status: "In Review" },
    });

    const { getByTestId, findByTestId, queryByTestId } = await render(<KycScreen />);
    await fireEvent.press(getByTestId("kyc-begin-verification"));

    const title = await findByTestId("kyc-result-title");
    expect(title.props.children).toMatch(/interrumpida/i);
    expect(queryByTestId("kyc-begin-verification")).toBeNull();
    expect(within(getByTestId("kyc-primary-action")).getByText(/reintentar/i)).toBeTruthy();
  });

  it("PENDING ofrece además consultar el estado, por si el resultado sí está en camino", async () => {
    mockKycStatus = KycStatus.PENDING;
    const { findByTestId } = await render(<KycScreen />);

    await fireEvent.press(await findByTestId("kyc-refresh-status"));

    expect(mockRefreshKycStatus).toHaveBeenCalled();
    expect(mockCreateKycSession).not.toHaveBeenCalled();
  });
});
