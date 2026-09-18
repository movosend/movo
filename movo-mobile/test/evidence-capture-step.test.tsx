import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { EvidenceCaptureStep } from "../components/evidence/evidence-capture-step";

const mockUseEvidenceStatus = jest.fn();
const mockUseEvidencePhotos = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useEvidenceStatus: (...args: unknown[]) => mockUseEvidenceStatus(...args),
}));

jest.mock("../src/hooks/use-evidence-photos", () => ({
  useEvidencePhotos: (...args: unknown[]) => mockUseEvidencePhotos(...args),
}));

function evidencePhotosState(overrides: Record<string, unknown> = {}) {
  return {
    photos: [],
    issue: null,
    clearIssue: jest.fn(),
    capture: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    confirmedThisSession: 0,
    ...overrides,
  };
}

describe("EvidenceCaptureStep (MOVO-197)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert");
    jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
    mockUseEvidencePhotos.mockReturnValue(evidencePhotosState());
  });

  it("nunca hardcodea mínimo/máximo — los toma de evidence-status", async () => {
    mockUseEvidenceStatus.mockReturnValue({
      data: { stage: "pickup", satisfied: false, photoCount: 0, minRequired: 3, maxAllowed: 4 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(
      <EvidenceCaptureStep shipmentId="s1" stage="pickup" />,
    );

    expect(getByText(/Sacá al menos 3 fotos/)).toBeTruthy();
  });

  it("notifica onValidityChange según 'satisfied' de evidence-status, no un conteo fijo", async () => {
    const onValidityChange = jest.fn();
    mockUseEvidenceStatus.mockReturnValue({
      data: { stage: "pickup", satisfied: true, photoCount: 1, minRequired: 1, maxAllowed: 5 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    await render(<EvidenceCaptureStep shipmentId="s1" stage="pickup" onValidityChange={onValidityChange} />);

    expect(onValidityChange).toHaveBeenCalledWith(true);
  });

  it("deshabilita capturar al llegar al máximo devuelto por el backend", async () => {
    mockUseEvidenceStatus.mockReturnValue({
      data: { stage: "pickup", satisfied: true, photoCount: 2, minRequired: 1, maxAllowed: 2 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseEvidencePhotos.mockReturnValue(
      evidencePhotosState({
        photos: [
          { id: "p1", localUri: "file:///1.jpg", status: "uploaded", progress: 100, errorMessage: null },
          { id: "p2", localUri: "file:///2.jpg", status: "uploaded", progress: 100, errorMessage: null },
        ],
        confirmedThisSession: 2,
      }),
    );

    const { queryByTestId } = await render(<EvidenceCaptureStep shipmentId="s1" stage="pickup" />);
    expect(queryByTestId("evidence-step-add")).toBeNull();
  });

  it("permiso denegado reintentable ofrece 'Reintentar' en vez de mandar a Ajustes", async () => {
    mockUseEvidenceStatus.mockReturnValue({
      data: { stage: "pickup", satisfied: false, photoCount: 0, minRequired: 1, maxAllowed: 5 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseEvidencePhotos.mockReturnValue(
      evidencePhotosState({ issue: { type: "denied", canAskAgain: true } }),
    );

    await act(async () => {
      await render(<EvidenceCaptureStep shipmentId="s1" stage="pickup" />);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Permiso necesario",
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: "Reintentar" })]),
    );
  });

  it("permiso denegado para siempre ofrece 'Abrir Ajustes'", async () => {
    mockUseEvidenceStatus.mockReturnValue({
      data: { stage: "delivery", satisfied: false, photoCount: 0, minRequired: 1, maxAllowed: 5 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseEvidencePhotos.mockReturnValue(
      evidencePhotosState({ issue: { type: "denied", canAskAgain: false } }),
    );

    await act(async () => {
      await render(<EvidenceCaptureStep shipmentId="s1" stage="delivery" />);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Permiso necesario",
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: "Abrir Ajustes" })]),
    );
  });

  it("cámara no disponible muestra un banner persistente, sin ofrecer galería", async () => {
    mockUseEvidenceStatus.mockReturnValue({
      data: { stage: "pickup", satisfied: false, photoCount: 0, minRequired: 1, maxAllowed: 5 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseEvidencePhotos.mockReturnValue(evidencePhotosState({ issue: { type: "unavailable" } }));

    const { getByTestId, queryByTestId, queryByText } = await render(
      <EvidenceCaptureStep shipmentId="s1" stage="pickup" />,
    );

    expect(getByTestId("evidence-step-camera-unavailable")).toBeTruthy();
    expect(queryByTestId("evidence-step-add")).toBeNull();
    expect(queryByText(/galería/i)).toBeNull();
  });

  it("error al cargar evidence-status ofrece reintentar", async () => {
    const refetch = jest.fn();
    mockUseEvidenceStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    const { getByTestId } = await render(<EvidenceCaptureStep shipmentId="s1" stage="pickup" />);
    fireEvent.press(getByTestId("evidence-step-status-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
