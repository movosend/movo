import { Alert, type AlertButton } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ReportReason, ReportStatus, type UserReportSummary } from "@movo/shared/dist/types/user";
import ReportUserScreen from "../app/(app)/profile/[id]/report";

const mockBack = jest.fn();
const mockReportMutate = jest.fn();
const mockAddEntry = jest.fn();
const mockBlockMutate = jest.fn();
const mockProfileRefetch = jest.fn();
const mockReportRefetch = jest.fn();

let mockProfileState: { data?: unknown; isLoading: boolean; isError: boolean };
let mockReportState: { isLoading: boolean; isError: boolean };
let mockPendingReport: UserReportSummary | null = null;
/** Lo que el caché tiene después de la mutación (el hook real hace `setQueryData` o
 * invalida tras un 409); acá se asigna antes de resolver. */
let mockPendingReportAfterMutation: UserReportSummary | null = null;
let mockReportError: unknown = null;
let mockAddEntryError: unknown = null;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "user-2" }),
  router: { back: () => mockBack(), canGoBack: () => true, replace: jest.fn() },
}));

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => ({ ...mockProfileState, refetch: mockProfileRefetch }),
}));

jest.mock("../src/hooks/use-moderation", () => ({
  usePendingReport: () => ({ ...mockReportState, data: mockPendingReport, refetch: mockReportRefetch }),
  useReportUser: () => ({
    mutateAsync: (input: unknown) => {
      mockReportMutate(input);
      mockPendingReport = mockPendingReportAfterMutation;
      return mockReportError ? Promise.reject(mockReportError) : Promise.resolve(mockPendingReport);
    },
    isPending: false,
  }),
  useAddReportEntry: () => ({
    mutateAsync: (details: string) => {
      mockAddEntry(details);
      return mockAddEntryError ? Promise.reject(mockAddEntryError) : Promise.resolve();
    },
    isPending: false,
  }),
  useBlockUser: () => ({
    mutate: (_arg: unknown, opts?: { onSuccess?: () => void }) => mockBlockMutate(opts),
    isPending: false,
  }),
}));

const PENDING_REPORT: UserReportSummary = {
  id: "report-1",
  reportedId: "user-2",
  reason: ReportReason.NO_SHOW,
  details: "No vino al retiro",
  status: ReportStatus.PENDING,
  createdAt: "2026-09-20T15:00:00.000Z",
  entries: [{ id: "entry-1", details: "Tampoco respondió mensajes", createdAt: "2026-09-21T15:00:00.000Z" }],
};

function profile(overrides: Record<string, unknown> = {}) {
  return { id: "user-2", fullName: "Marta González", isBlockedByMe: false, ...overrides };
}

async function pressAndFlush(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

describe("ReportUserScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfileState = { data: profile(), isLoading: false, isError: false };
    mockReportState = { isLoading: false, isError: false };
    mockPendingReport = null;
    mockPendingReportAfterMutation = null;
    mockReportError = null;
    mockAddEntryError = null;
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("muestra un spinner mientras carga el perfil o el reporte", async () => {
    mockReportState = { isLoading: true, isError: false };
    const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

    expect(getByTestId("report-screen-loading")).toBeTruthy();
    expect(queryByTestId("report-screen-form")).toBeNull();
  });

  it("con error de carga ofrece reintentar las dos consultas", async () => {
    mockReportState = { isLoading: false, isError: true };
    const { getByTestId } = await render(<ReportUserScreen />);

    await fireEvent.press(getByTestId("report-screen-retry"));

    expect(mockProfileRefetch).toHaveBeenCalled();
    expect(mockReportRefetch).toHaveBeenCalled();
  });

  it("sin reporte en revisión muestra el formulario y exige un motivo", async () => {
    const { getByTestId, getByText } = await render(<ReportUserScreen />);

    expect(getByText("Reportar a Marta González")).toBeTruthy();
    await pressAndFlush(getByTestId("report-screen-form-submit"));

    expect(getByText("Elegí un motivo para continuar.")).toBeTruthy();
    expect(mockReportMutate).not.toHaveBeenCalled();
  });

  it("al enviar el reporte la pantalla pasa a mostrarlo y ofrece bloquear", async () => {
    mockPendingReportAfterMutation = { ...PENDING_REPORT, details: "Me dejó plantado", entries: [] };
    const { getByTestId, getByText, queryByTestId } = await render(<ReportUserScreen />);

    await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.NO_SHOW}`));
    await fireEvent.changeText(getByTestId("report-screen-form-details-input"), "  Me dejó plantado  ");
    await pressAndFlush(getByTestId("report-screen-form-submit"));

    expect(mockReportMutate).toHaveBeenCalledWith({ reason: ReportReason.NO_SHOW, details: "Me dejó plantado" });
    expect(queryByTestId("report-screen-form")).toBeNull();
    expect(getByTestId("report-screen-created")).toBeTruthy();
    expect(getByText("Tu reporte")).toBeTruthy();
    expect(getByTestId("report-screen-pending")).toBeTruthy();

    await fireEvent.press(getByTestId("report-screen-block-button"));
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as AlertButton[];
    await act(async () => {
      buttons.find((b) => b.style !== "cancel")?.onPress?.();
    });
    const opts = mockBlockMutate.mock.calls[0][0] as { onSuccess?: () => void };
    await act(async () => {
      opts.onSuccess?.();
    });
    expect(getByTestId("report-screen-success")).toBeTruthy();
  });

  it("si ya está bloqueado, el agradecimiento no ofrece bloquear", async () => {
    mockProfileState = { data: profile({ isBlockedByMe: true }), isLoading: false, isError: false };
    mockPendingReportAfterMutation = PENDING_REPORT;
    const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

    await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.OTHER}`));
    await pressAndFlush(getByTestId("report-screen-form-submit"));

    expect(getByTestId("report-screen-created")).toBeTruthy();
    expect(queryByTestId("report-screen-block-button")).toBeNull();
  });

  it("muestra el límite diario de reportes con copy propio y conserva el formulario", async () => {
    mockReportError = new ApiError(429, "RATE_LIMIT_EXCEEDED", "rate limited");
    const { getByTestId, getByText } = await render(<ReportUserScreen />);

    await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.OTHER}`));
    await pressAndFlush(getByTestId("report-screen-form-submit"));

    expect(getByText("Hiciste demasiados reportes hoy. Probá de nuevo mañana.")).toBeTruthy();
    expect(getByTestId("report-screen-form")).toBeTruthy();
  });

  it("con un reporte en revisión muestra lo enviado, sin formulario de reporte nuevo", async () => {
    mockPendingReport = PENDING_REPORT;
    const { getByTestId, getByText, queryByTestId } = await render(<ReportUserScreen />);

    expect(getByText("Tu reporte")).toBeTruthy();
    expect(getByTestId("report-screen-pending-reason").props.children).toBe("No se presentó");
    expect(getByText("No vino al retiro")).toBeTruthy();
    expect(getByText("Tampoco respondió mensajes")).toBeTruthy();
    expect(queryByTestId("report-screen-form")).toBeNull();
    expect(queryByTestId("report-screen-created")).toBeNull();
  });

  it("suma información al reporte en revisión", async () => {
    mockPendingReport = PENDING_REPORT;
    const { getByTestId } = await render(<ReportUserScreen />);

    expect(getByTestId("report-screen-pending-add-button").props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.changeText(getByTestId("report-screen-pending-entry-input"), "  Me insultó por chat  ");
    await pressAndFlush(getByTestId("report-screen-pending-add-button"));

    expect(mockAddEntry).toHaveBeenCalledWith("Me insultó por chat");
    expect(mockReportMutate).not.toHaveBeenCalled();
    expect(getByTestId("report-screen-pending-entry-added")).toBeTruthy();
    expect(getByTestId("report-screen-pending-entry-input").props.value).toBe("");
  });

  it("un error al sumar información se muestra y conserva lo escrito", async () => {
    mockPendingReport = PENDING_REPORT;
    mockAddEntryError = new ApiError(429, "RATE_LIMIT_EXCEEDED", "rate limited");
    const { getByTestId, getByText } = await render(<ReportUserScreen />);

    await fireEvent.changeText(getByTestId("report-screen-pending-entry-input"), "Algo más");
    await pressAndFlush(getByTestId("report-screen-pending-add-button"));

    expect(getByText("Hiciste demasiados reportes hoy. Probá de nuevo mañana.")).toBeTruthy();
    expect(getByTestId("report-screen-pending-entry-input").props.value).toBe("Algo más");
  });

  it("si al reportar ya había uno en revisión, muestra ese reporte con un aviso", async () => {
    mockReportError = new ApiError(409, "REPORT_ALREADY_PENDING", "ya existe");
    mockPendingReportAfterMutation = PENDING_REPORT;
    const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

    await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.HARASSMENT}`));
    await fireEvent.changeText(getByTestId("report-screen-form-details-input"), "Me insultó");
    await pressAndFlush(getByTestId("report-screen-form-submit"));

    expect(getByTestId("report-screen-pending-notice").props.children).toBeTruthy();
    expect(getByTestId("report-screen-pending-entry-input").props.value).toBe("");
    expect(queryByTestId("report-screen-created")).toBeNull();
  });
});
