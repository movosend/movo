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
const mockPresign = jest.fn();
const mockUpload = jest.fn();
const mockPickGallery = jest.fn();

let mockProfileState: { data?: unknown; isLoading: boolean; isError: boolean };
let mockReportState: { isLoading: boolean; isError: boolean };
let mockPendingReport: UserReportSummary | null = null;
/** Lo que el caché tiene después de la mutación (el hook real hace `setQueryData` o
 * invalida tras un 409); acá se asigna antes de resolver. */
let mockPendingReportAfterMutation: UserReportSummary | null = null;
let mockReportError: unknown = null;
let mockAddEntryError: unknown = null;
let mockUuid = 0;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "user-2" }),
  router: { back: () => mockBack(), canGoBack: () => true, replace: jest.fn() },
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => `local-${++mockUuid}` }));

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
    mutateAsync: (input: unknown) => {
      mockAddEntry(input);
      return mockAddEntryError ? Promise.reject(mockAddEntryError) : Promise.resolve();
    },
    isPending: false,
  }),
  useBlockUser: () => ({
    mutate: (_arg: unknown, opts?: { onSuccess?: () => void }) => mockBlockMutate(opts),
    isPending: false,
  }),
}));

// MOVO-256: el ciclo real de `useReportPhotos` (comprimir → presign → PUT) con sus
// dependencias de red y del dispositivo simuladas.
jest.mock("../src/api/moderation-client", () => ({
  moderationClient: { presignReportPhoto: (...args: unknown[]) => mockPresign(...args) },
}));
jest.mock("../src/lib/s3-upload", () => ({
  uploadBlobToPresignedUrl: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock("../src/lib/photo-utils", () => ({
  takePhotoWithCamera: jest.fn(),
  pickPhotoFromGallery: (...args: unknown[]) => mockPickGallery(...args),
  prepareImageForUpload: (uri: string) =>
    Promise.resolve({ uri: `${uri}-compressed`, contentType: "image/jpeg", contentLength: 1024, blob: { size: 1024 } }),
  uriToBlob: jest.fn(),
}));

const PENDING_REPORT: UserReportSummary = {
  id: "report-1",
  reportedId: "user-2",
  reason: ReportReason.NO_SHOW,
  details: "No vino al retiro",
  status: ReportStatus.PENDING,
  createdAt: "2026-09-20T15:00:00.000Z",
  photos: [
    { id: "photo-1", url: "https://s3.test/reports/a/1.jpg?sig", expiresIn: 300 },
    { id: "photo-2", url: "https://s3.test/reports/a/2.jpg?sig", expiresIn: 300 },
  ],
  entries: [
    { id: "entry-1", details: "Tampoco respondió mensajes", createdAt: "2026-09-21T15:00:00.000Z", photos: [] },
    {
      id: "entry-2",
      details: null,
      createdAt: "2026-09-22T15:00:00.000Z",
      photos: [{ id: "photo-3", url: "https://s3.test/reports/a/3.jpg?sig", expiresIn: 300 }],
    },
  ],
};

function profile(overrides: Record<string, unknown> = {}) {
  return { id: "user-2", fullName: "Marta González", isBlockedByMe: false, ...overrides };
}

async function pressAndFlush(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

/** Toca "agregar foto" y elige la galería en el diálogo nativo. */
async function addPhotoFromGallery(getByTestId: (id: string) => Parameters<typeof fireEvent.press>[0], testID: string) {
  await pressAndFlush(getByTestId(testID));
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async () => {
    buttons.find((b) => b.text === "Elegir de la galería")?.onPress?.();
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
    mockUuid = 0;
    mockPickGallery.mockResolvedValue({ cancelled: false, uri: "file:///gallery.jpg" });
    mockPresign.mockImplementation(() =>
      Promise.resolve({ uploadUrl: "https://s3.test/put", s3Key: `reports/me/${mockUuid}.jpg`, expiresIn: 300 }),
    );
    mockUpload.mockResolvedValue(undefined);
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

  describe("reporte nuevo", () => {
    it("muestra el formulario y exige un motivo", async () => {
      const { getByTestId, getByText } = await render(<ReportUserScreen />);

      expect(getByText("Reportar a Marta González")).toBeTruthy();
      await pressAndFlush(getByTestId("report-screen-form-submit"));

      expect(getByText("Elegí un motivo para continuar.")).toBeTruthy();
      expect(mockReportMutate).not.toHaveBeenCalled();
    });

    it("al enviar el reporte la pantalla pasa a mostrarlo como hilo", async () => {
      mockPendingReportAfterMutation = { ...PENDING_REPORT, details: "Me dejó plantado", photos: [], entries: [] };
      const { getByTestId, getByText, queryByTestId, rerender } = await render(<ReportUserScreen />);

      await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.NO_SHOW}`));
      await fireEvent.changeText(getByTestId("report-screen-form-details-input"), "  Me dejó plantado  ");
      await pressAndFlush(getByTestId("report-screen-form-submit"));
      // El hook real hace `setQueryData` y la query re-renderiza la pantalla; el mock
      // solo actualiza la variable, así que se re-renderiza a mano.
      await rerender(<ReportUserScreen />);

      expect(mockReportMutate).toHaveBeenCalledWith({ reason: ReportReason.NO_SHOW, details: "Me dejó plantado" });
      expect(queryByTestId("report-screen-form")).toBeNull();
      expect(getByText("Tu reporte")).toBeTruthy();
      expect(getByText("Sobre Marta González")).toBeTruthy();
      expect(getByTestId("report-screen-pending-status")).toBeTruthy();
    });

    it("adjunta fotos ya subidas al reporte", async () => {
      mockPendingReportAfterMutation = PENDING_REPORT;
      const { getByTestId } = await render(<ReportUserScreen />);

      await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.DAMAGED_PACKAGE}`));
      await addPhotoFromGallery(getByTestId, "report-screen-form-add-photo");
      expect(getByTestId("report-screen-form-draft-photos-count").props.children).toEqual([1, "/", 4]);
      await pressAndFlush(getByTestId("report-screen-form-submit"));

      expect(mockPresign).toHaveBeenCalledWith("user-2", 1024);
      expect(mockReportMutate).toHaveBeenCalledWith({
        reason: ReportReason.DAMAGED_PACKAGE,
        details: undefined,
        photoKeys: ["reports/me/1.jpg"],
      });
    });

    it("muestra el límite diario de reportes con copy propio y conserva el formulario", async () => {
      mockReportError = new ApiError(429, "RATE_LIMIT_EXCEEDED", "rate limited");
      const { getByTestId, getByText } = await render(<ReportUserScreen />);

      await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.OTHER}`));
      await pressAndFlush(getByTestId("report-screen-form-submit"));

      expect(getByText("Hiciste demasiados reportes hoy. Probá de nuevo mañana.")).toBeTruthy();
      expect(getByTestId("report-screen-form")).toBeTruthy();
    });

    it("si al reportar ya había uno en revisión, muestra ese reporte con un aviso", async () => {
      mockReportError = new ApiError(409, "REPORT_ALREADY_PENDING", "ya existe");
      mockPendingReportAfterMutation = PENDING_REPORT;
      const { getByTestId } = await render(<ReportUserScreen />);

      await fireEvent.press(getByTestId(`report-screen-form-reason-${ReportReason.HARASSMENT}`));
      await fireEvent.changeText(getByTestId("report-screen-form-details-input"), "Me insultó");
      await pressAndFlush(getByTestId("report-screen-form-submit"));

      expect(getByTestId("report-screen-pending-notice").props.children).toBeTruthy();
      expect(getByTestId("report-screen-pending-entry-input").props.value).toBe("");
    });
  });

  describe("reporte en revisión (hilo, mockup 1A)", () => {
    beforeEach(() => {
      mockPendingReport = PENDING_REPORT;
    });

    it("muestra el estado, lo original y cada entrada con sus fotos", async () => {
      const { getByTestId, getByText, queryByTestId } = await render(<ReportUserScreen />);

      expect(getByText("En revisión")).toBeTruthy();
      expect(getByText("Recibimos tu reporte sobre Marta González.")).toBeTruthy();
      expect(getByTestId("report-screen-pending-reason").props.children).toBe("No se presentó");
      expect(getByText("Reporte inicial")).toBeTruthy();
      expect(getByText("No vino al retiro")).toBeTruthy();
      expect(getByText("Tampoco respondió mensajes")).toBeTruthy();
      expect(getByTestId("report-screen-pending-item-0-photos-1")).toBeTruthy();
      // La entrada solo-fotos no tiene texto, solo su grilla.
      expect(queryByTestId("report-screen-pending-item-2-text")).toBeNull();
      expect(getByTestId("report-screen-pending-item-2-photos-0")).toBeTruthy();
      expect(queryByTestId("report-screen-form")).toBeNull();
    });

    it("tolera un backend que todavía no manda `photos` (sin desplegar MOVO-256)", async () => {
      const { photos: _photos, entries, ...legacy } = PENDING_REPORT;
      mockPendingReport = {
        ...legacy,
        entries: entries.map(({ photos: _p, ...entry }) => entry),
      } as unknown as UserReportSummary;
      const { getByText, queryByTestId } = await render(<ReportUserScreen />);

      expect(getByText("No vino al retiro")).toBeTruthy();
      expect(queryByTestId("report-screen-pending-item-0-photos")).toBeNull();
    });

    it("tocar una foto enviada la abre a pantalla completa", async () => {
      const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

      expect(queryByTestId("report-screen-pending-item-0-photos-viewer-close")).toBeNull();
      await pressAndFlush(getByTestId("report-screen-pending-item-0-photos-1"));

      expect(getByTestId("report-screen-pending-item-0-photos-viewer-close")).toBeTruthy();
    });

    it("suma texto al reporte y avisa con el toast", async () => {
      const { getByTestId, getByText } = await render(<ReportUserScreen />);

      expect(getByTestId("report-screen-pending-add-button").props.accessibilityState).toEqual({ disabled: true });
      await fireEvent.changeText(getByTestId("report-screen-pending-entry-input"), "  Me insultó por chat  ");
      await pressAndFlush(getByTestId("report-screen-pending-add-button"));

      expect(mockAddEntry).toHaveBeenCalledWith({ details: "Me insultó por chat" });
      expect(getByText("Lo sumamos a tu reporte.")).toBeTruthy();
      expect(getByTestId("report-screen-pending-entry-input").props.value).toBe("");
    });

    it("suma solo fotos: se habilita el envío sin texto", async () => {
      const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

      await addPhotoFromGallery(getByTestId, "report-screen-pending-add-photo");
      expect(getByTestId("report-screen-pending-add-button").props.accessibilityState).toEqual({ disabled: false });
      await pressAndFlush(getByTestId("report-screen-pending-add-button"));

      expect(mockAddEntry).toHaveBeenCalledWith({ photoKeys: ["reports/me/1.jpg"] });
      // El composer vuelve a quedar vacío.
      expect(queryByTestId("report-screen-pending-draft-photos")).toBeNull();
    });

    it("una foto se puede quitar antes de enviar", async () => {
      const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

      await addPhotoFromGallery(getByTestId, "report-screen-pending-add-photo");
      await pressAndFlush(getByTestId("report-screen-pending-draft-photos-0-remove"));

      expect(queryByTestId("report-screen-pending-draft-photos")).toBeNull();
      expect(getByTestId("report-screen-pending-add-button").props.accessibilityState).toEqual({ disabled: true });
    });

    it("un error de subida queda en la foto, bloquea el envío y se reintenta tocándola", async () => {
      mockUpload.mockRejectedValueOnce(new Error("network"));
      const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

      await fireEvent.changeText(getByTestId("report-screen-pending-entry-input"), "Mirá la foto");
      await addPhotoFromGallery(getByTestId, "report-screen-pending-add-photo");

      expect(getByTestId("report-screen-pending-draft-photos-0-error")).toBeTruthy();
      expect(getByTestId("report-screen-pending-draft-photos-error-hint")).toBeTruthy();
      expect(getByTestId("report-screen-pending-add-button").props.accessibilityState).toEqual({ disabled: true });

      await pressAndFlush(getByTestId("report-screen-pending-draft-photos-0"));

      expect(queryByTestId("report-screen-pending-draft-photos-0-error")).toBeNull();
      expect(mockUpload).toHaveBeenCalledTimes(2);
      expect(getByTestId("report-screen-pending-add-button").props.accessibilityState).toEqual({ disabled: false });
    });

    it("no deja agregar más de 4 fotos por envío", async () => {
      const { getByTestId } = await render(<ReportUserScreen />);

      for (let i = 0; i < 4; i++) {
        await addPhotoFromGallery(getByTestId, "report-screen-pending-add-photo");
      }

      expect(getByTestId("report-screen-pending-draft-photos-count").props.children).toEqual([4, "/", 4]);
      expect(getByTestId("report-screen-pending-add-photo").props.accessibilityState).toEqual({ disabled: true });
    });

    it("un error al sumar información se muestra y conserva lo escrito", async () => {
      mockAddEntryError = new ApiError(429, "RATE_LIMIT_EXCEEDED", "rate limited");
      const { getByTestId, getByText } = await render(<ReportUserScreen />);

      await fireEvent.changeText(getByTestId("report-screen-pending-entry-input"), "Algo más");
      await pressAndFlush(getByTestId("report-screen-pending-add-button"));

      expect(getByText("Hiciste demasiados reportes hoy. Probá de nuevo mañana.")).toBeTruthy();
      expect(getByTestId("report-screen-pending-entry-input").props.value).toBe("Algo más");
    });

    it("bloquear es una acción secundaria con confirmación y avisa con el toast", async () => {
      const { getByTestId, getByText } = await render(<ReportUserScreen />);

      expect(getByText("Bloquear a Marta")).toBeTruthy();
      await pressAndFlush(getByTestId("report-screen-pending-block"));
      const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as AlertButton[];
      await act(async () => {
        buttons.find((b) => b.style === "destructive")?.onPress?.();
      });
      const opts = mockBlockMutate.mock.calls[0][0] as { onSuccess?: () => void };
      await act(async () => {
        opts.onSuccess?.();
      });

      expect(getByText("Bloqueaste a Marta González.")).toBeTruthy();
    });

    it("si ya está bloqueado, muestra el estado en vez de ofrecer bloquear", async () => {
      mockProfileState = { data: profile({ isBlockedByMe: true }), isLoading: false, isError: false };
      const { getByTestId, queryByTestId } = await render(<ReportUserScreen />);

      expect(getByTestId("report-screen-pending-blocked")).toBeTruthy();
      expect(queryByTestId("report-screen-pending-block")).toBeNull();
    });
  });
});
