import { act, fireEvent, render } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import PaymentsSettingsScreen from "../app/(app)/profile/payments";

type StatusState = {
  data?: unknown;
  isError: boolean;
  error?: unknown;
};

const mockRefetch = jest.fn();
const mockStart = jest.fn();
const mockClearError = jest.fn();
const mockUnlinkMutate = jest.fn();
let mockStatus: StatusState = { data: undefined, isError: false };
let mockLink: { phase: string; error: string | null } = { phase: "idle", error: null };
let mockUnlinkPending = false;
let mockUnlinkOptions: { onSuccess?: () => void; onError?: (err: unknown) => void } = {};

jest.mock("../src/hooks/use-mp-connect", () => ({
  useMpConnectStatus: () => ({ ...mockStatus, refetch: mockRefetch }),
  useLinkMpAccount: () => ({ ...mockLink, start: mockStart, clearError: mockClearError }),
  useUnlinkMpAccount: (opts: typeof mockUnlinkOptions) => {
    mockUnlinkOptions = opts;
    return { mutate: mockUnlinkMutate, isPending: mockUnlinkPending };
  },
}));

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  // Corre el efecto una vez, como el foco inicial de la pantalla.
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(cb, [cb]);
  },
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { fullName: "Julieta Ramos" } }),
}));

const LINKED = {
  status: "linked",
  account: {
    mpUserId: "2991764998",
    email: "julieta.ramos@gmail.com",
    nickname: "JULIETARAMOS",
    connectedAt: "2026-09-12T15:00:00.000Z",
  },
  invalidReason: null,
};
const UNLINKED = { status: "unlinked", account: null, invalidReason: null };
const INVALID = { ...LINKED, status: "invalid", invalidReason: "revoked" };

describe("PaymentsSettingsScreen (MOVO-112)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = { data: undefined, isError: false };
    mockLink = { phase: "idle", error: null };
    mockUnlinkPending = false;
  });

  it("muestra el skeleton mientras consulta el status", async () => {
    const { getByTestId, getByText } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("mp-connect-loading")).toBeTruthy();
    expect(getByText("Consultando el estado de tu cuenta…")).toBeTruthy();
  });

  it("vuelve a consultar el status al ganar foco", async () => {
    await render(<PaymentsSettingsScreen />);
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("sin vincular: logo, aviso persistente de que no puede cobrar y botón de vincular (AC1, AC6)", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    const { getByTestId, getByText } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-card-unlinked")).toBeTruthy();
    expect(getByTestId("mp-connect-logo")).toBeTruthy();
    expect(getByText("Sin vincular")).toBeTruthy();
    expect(getByTestId("mp-connect-unlinked-warning")).toBeTruthy();
    expect(getByText("Vincular cuenta de Mercado Pago")).toBeTruthy();
  });

  it("tocar vincular arranca el flujo (AC2)", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);

    fireEvent.press(getByTestId("mp-connect-link-button"));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("el botón queda deshabilitado mientras hay un intento en curso", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    mockLink = { phase: "browser", error: null };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);

    fireEvent.press(getByTestId("mp-connect-link-button"));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("al volver del navegador muestra 'Terminando la vinculación…'", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    mockLink = { phase: "finishing", error: null };
    const { getByTestId, getByText, queryByTestId } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-finishing")).toBeTruthy();
    expect(getByText("Terminando la vinculación…")).toBeTruthy();
    expect(queryByTestId("mp-connect-card-unlinked")).toBeNull();
  });

  it("vinculada: email de MP, fecha y botón Desvincular (AC1)", async () => {
    mockStatus = { data: LINKED, isError: false };
    const { getByTestId, getByText, queryByTestId } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-card-linked")).toBeTruthy();
    expect(getByTestId("mp-connect-linked-logo")).toBeTruthy();
    expect(getByText("Vinculada")).toBeTruthy();
    expect(getByTestId("mp-connect-account-email").props.children).toBe("julieta.ramos@gmail.com");
    expect(getByText("JR")).toBeTruthy();
    expect(getByText(/Vinculada el 12 sep/)).toBeTruthy();
    expect(queryByTestId("mp-connect-unlinked-warning")).toBeNull();
  });

  it("inválida: explica qué pasó, tacha la cuenta y ofrece volver a vincular (AC1, AC6)", async () => {
    mockStatus = { data: INVALID, isError: false };
    const { getByTestId, getByText } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-card-invalid")).toBeTruthy();
    expect(getByText("Dejó de funcionar")).toBeTruthy();
    expect(getByText("Tu vinculación dejó de funcionar")).toBeTruthy();
    expect(getByTestId("mp-connect-invalid-email").props.children).toBe("julieta.ramos@gmail.com");

    fireEvent.press(getByTestId("mp-connect-relink-button"));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("un error de vinculación se muestra arriba del estado real, sin cambiarlo (AC4)", async () => {
    mockStatus = { data: INVALID, isError: false };
    mockLink = { phase: "idle", error: "No pudimos vincular tu cuenta." };
    const { getByTestId, queryByTestId } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-link-error")).toBeTruthy();
    expect(getByTestId("mp-connect-card-invalid")).toBeTruthy();
    expect(queryByTestId("mp-connect-card-unlinked")).toBeNull();
  });

  it("después de un error, el botón de 'sin vincular' dice Reintentar", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    mockLink = { phase: "idle", error: "No pudimos vincular tu cuenta." };
    const { getByText } = await render(<PaymentsSettingsScreen />);

    expect(getByText("Reintentar")).toBeTruthy();
  });

  it("si falla consultar el status, muestra el error con Reintentar", async () => {
    mockStatus = { data: undefined, isError: true, error: new Error("network") };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-status-error")).toBeTruthy();
    mockRefetch.mockClear();
    fireEvent.press(getByTestId("mp-connect-status-retry"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("si la vinculación no está configurada (503), muestra el aviso sin Reintentar", async () => {
    mockStatus = {
      data: undefined,
      isError: true,
      error: new ApiError(503, "MP_CONNECT_NOT_CONFIGURED", "not configured"),
    };
    const { getByTestId, queryByTestId, getByText } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-status-error")).toBeTruthy();
    expect(getByText(/no está disponible por ahora/)).toBeTruthy();
    expect(queryByTestId("mp-connect-status-retry")).toBeNull();
  });

  it("no vuelve a consultar el status cuando cambia la fase de vinculación", async () => {
    mockStatus = { data: { status: "unlinked", account: null, invalidReason: null }, isError: false };
    const { rerender } = await render(<PaymentsSettingsScreen />);
    mockRefetch.mockClear();

    mockLink = { phase: "finishing", error: null };
    await rerender(<PaymentsSettingsScreen />);
    mockLink = { phase: "idle", error: null };
    await rerender(<PaymentsSettingsScreen />);

    expect(mockRefetch).not.toHaveBeenCalled();
  });

  describe("desvincular (AC5)", () => {
    it("pide confirmación antes de desvincular", async () => {
      mockStatus = { data: LINKED, isError: false };
      const { getByTestId, queryByTestId } = await render(<PaymentsSettingsScreen />);

      expect(queryByTestId("unlink-mp-sheet-confirm")).toBeNull();
      await act(async () => {
        fireEvent.press(getByTestId("mp-connect-unlink-button"));
      });
      expect(getByTestId("unlink-mp-sheet-confirm")).toBeTruthy();
      expect(mockUnlinkMutate).not.toHaveBeenCalled();
    });

    it("confirmar ejecuta el DELETE", async () => {
      mockStatus = { data: LINKED, isError: false };
      const { getByTestId } = await render(<PaymentsSettingsScreen />);

      await act(async () => {
        fireEvent.press(getByTestId("mp-connect-unlink-button"));
      });
      await act(async () => {
        fireEvent.press(getByTestId("unlink-mp-sheet-confirm"));
      });
      expect(mockUnlinkMutate).toHaveBeenCalledTimes(1);
    });

    it("Volver cierra sin desvincular", async () => {
      mockStatus = { data: LINKED, isError: false };
      const { getByTestId } = await render(<PaymentsSettingsScreen />);

      await act(async () => {
        fireEvent.press(getByTestId("mp-connect-unlink-button"));
      });
      await act(async () => {
        fireEvent.press(getByTestId("unlink-mp-sheet-cancel"));
      });
      expect(mockUnlinkMutate).not.toHaveBeenCalled();
    });

    it("si el DELETE falla, muestra el error", async () => {
      mockStatus = { data: LINKED, isError: false };
      const { getByTestId } = await render(<PaymentsSettingsScreen />);

      await act(async () => {
        mockUnlinkOptions.onError?.(new Error("network"));
      });
      expect(getByTestId("mp-connect-unlink-error")).toBeTruthy();
    });
  });
});
