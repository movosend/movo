import { act, fireEvent, render } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router } from "expo-router";
import PaymentsSettingsScreen from "../app/(app)/profile/payments";

type Screen = Awaited<ReturnType<typeof render>>;

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

type MutationOptions = { onSuccess?: (card: never) => void; onError?: (err: unknown) => void };
type CardsState = { data?: unknown; isError: boolean; error?: unknown };
const mockCardsRefetch = jest.fn();
let mockCards: CardsState = { data: [], isError: false };
const mockSetDefault = jest.fn();
const mockRename = jest.fn();
const mockDelete = jest.fn();
let mockSetDefaultOptions: MutationOptions = {};
let mockRenameOptions: MutationOptions = {};
let mockDeleteOptions: MutationOptions = {};
let mockParams: { toast?: string; tab?: string } = { tab: "methods" };

jest.mock("../src/hooks/use-saved-cards", () => ({
  useSavedCards: () => ({ ...mockCards, refetch: mockCardsRefetch }),
  useSetDefaultCard: (opts: MutationOptions) => {
    mockSetDefaultOptions = opts;
    return { mutate: mockSetDefault, isPending: false };
  },
  useRenameCard: (opts: MutationOptions) => {
    mockRenameOptions = opts;
    return { mutate: mockRename, isPending: false };
  },
  useDeleteCard: (opts: MutationOptions) => {
    mockDeleteOptions = opts;
    return { mutate: mockDelete, isPending: false };
  },
}));

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => mockParams,
  // Corre el efecto una vez, como el foco inicial de la pantalla.
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(cb, [cb]);
  },
}));

let mockBalance: { isPending: boolean; isError: boolean; data?: { pages: { balanceArs: number }[] } } = { isPending: false, isError: false, data: { pages: [{ balanceArs: 0 }] } };
jest.mock("../src/hooks/use-balance", () => ({ useBalance: () => mockBalance }));
jest.mock("../components/payments/balance-tab", () => ({ BalanceTab: () => { const { Text } = require("react-native"); return <Text>balance-tab-stub</Text>; } }));
jest.mock("../components/payments/history-tab", () => ({ HistoryTab: () => { const { Text } = require("react-native"); return <Text>history-tab-stub</Text>; } }));

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
    mockCards = { data: [], isError: false };
    mockParams = { tab: "methods" };
    mockBalance = { isPending: false, isError: false, data: { pages: [{ balanceArs: 0 }] } };
  });

  it("muestra el skeleton mientras consulta el status", async () => {
    const { getByTestId, getByText } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("mp-connect-loading")).toBeTruthy();
    expect(getByText("Consultando el estado de tu cuenta…")).toBeTruthy();
  });

  it("tiene las pestañas Saldo, Historial y Medios (prototipo 2c)", async () => {
    const { getByText, getByTestId } = await render(<PaymentsSettingsScreen />);

    expect(getByText("Saldo")).toBeTruthy();
    expect(getByText("Historial")).toBeTruthy();
    expect(getByText("Medios")).toBeTruthy();
    expect(getByTestId("payments-tab-methods").props.accessibilityState.selected).toBe(true);
    await act(async () => fireEvent.press(getByTestId("payments-tab-history")));
    expect(getByText("history-tab-stub")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("payments-tab-balance")));
    expect(getByText("balance-tab-stub")).toBeTruthy();
  });

  it("sin ?tab= y sin deuda se abre en Historial", async () => {
    mockParams = {};
    const { getByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("payments-tab-history").props.accessibilityState.selected).toBe(true);
  });

  it("sin ?tab= y con deuda se abre en Saldo", async () => {
    mockParams = {};
    mockBalance = { isPending: false, isError: false, data: { pages: [{ balanceArs: 4100 }] } };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("payments-tab-balance").props.accessibilityState.selected).toBe(true);
  });

  it("mientras carga el saldo no salta a Historial", async () => {
    mockParams = {};
    mockBalance = { isPending: true, isError: false };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("payments-tab-balance").props.accessibilityState.selected).toBe(true);
  });

  it("vuelve a consultar el status al ganar foco", async () => {
    await render(<PaymentsSettingsScreen />);
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("sin vincular: estado vacío que explica que no puede cobrar y botón de vincular (AC1, AC6)", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    const { getByTestId, getByText } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-card-unlinked")).toBeTruthy();
    expect(getByTestId("mp-connect-logo")).toBeTruthy();
    expect(getByText("Todavía no vinculaste una cuenta")).toBeTruthy();
    expect(getByText(/llevar envíos y cobrar/)).toBeTruthy();
    expect(getByText("Vincular Mercado Pago")).toBeTruthy();
  });

  it("al vincular con éxito avisa con un toast", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    mockStart.mockResolvedValueOnce(true);
    const { getByTestId, findByText } = await render(<PaymentsSettingsScreen />);

    await act(async () => fireEvent.press(getByTestId("mp-connect-link-button")));
    expect(await findByText("Vinculaste tu cuenta de Mercado Pago.")).toBeTruthy();
  });

  it("tocar vincular arranca el flujo (AC2)", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);

    await act(async () => fireEvent.press(getByTestId("mp-connect-link-button")));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("el botón queda deshabilitado mientras hay un intento en curso", async () => {
    mockStatus = { data: UNLINKED, isError: false };
    mockLink = { phase: "browser", error: null };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);

    await act(async () => fireEvent.press(getByTestId("mp-connect-link-button")));
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

  it("vinculada: fila de Mercado Pago con email y fecha, y 'Cambiar cuenta' con confirmación (AC1)", async () => {
    mockStatus = { data: LINKED, isError: false };
    const { getByTestId, queryByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-card-linked")).toBeTruthy();
    expect(getByTestId("mp-connect-linked-logo")).toBeTruthy();
    expect(getByTestId("mp-connect-account-email").props.children).toBe("julieta.ramos@gmail.com");
    expect(getByTestId("mp-connect-account-meta").props.children).toMatch(/Vinculada el 12 sep/);
    expect(queryByTestId("mp-connect-card-unlinked")).toBeNull();

    await act(async () => fireEvent.press(getByTestId("mp-connect-change-account")));
    expect(mockStart).not.toHaveBeenCalled();
    expect(await findByTestId("change-mp-sheet")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("change-mp-sheet-confirm")));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("cancelar la confirmación de 'Cambiar cuenta' no inicia el OAuth", async () => {
    mockStatus = { data: LINKED, isError: false };
    const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);

    await act(async () => fireEvent.press(getByTestId("mp-connect-change-account")));
    expect(await findByTestId("change-mp-sheet")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("change-mp-sheet-cancel")));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("inválida: tacha la cuenta, explica qué pasó y ofrece volver a vincular (AC1, AC6)", async () => {
    mockStatus = { data: INVALID, isError: false };
    const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);

    expect(getByTestId("mp-connect-card-invalid")).toBeTruthy();
    expect(getByTestId("mp-connect-invalid-email").props.children).toBe("julieta.ramos@gmail.com");
    expect(getByTestId("mp-connect-account-meta").props.children).toMatch(/Dejó de funcionar/);

    await act(async () => fireEvent.press(getByTestId("mp-connect-relink-button")));
    expect(mockStart).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.press(getByTestId("mp-connect-account-row")));
    expect(await findByTestId("mp-account-sheet-invalid-note")).toBeTruthy();
    expect(getByTestId("mp-account-sheet-link").props.accessibilityLabel).toBe("Volver a vincular");
  });

  it("acorta un email largo de la cuenta vinculada", async () => {
    mockStatus = {
      data: { ...LINKED, account: { ...LINKED.account, email: "test_user_7133831507754225491@testuser.com" } },
      isError: false,
    };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("mp-connect-account-email").props.children).toBe("test_user_7133…@testuser.com");
  });

  it("las opciones de la cuenta permiten cambiarla", async () => {
    mockStatus = { data: LINKED, isError: false };
    const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);

    await act(async () => fireEvent.press(getByTestId("mp-connect-account-row")));
    expect(await findByTestId("mp-account-sheet-note")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("mp-account-sheet-link")));
    expect(mockStart).not.toHaveBeenCalled();
    expect(await findByTestId("change-mp-sheet")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("change-mp-sheet-confirm")));
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
    // Desvincular está dentro de las opciones de la cuenta, como eliminar una tarjeta.
    async function openUnlinkSheet(
      getByTestId: Screen["getByTestId"],
      findByTestId: Screen["findByTestId"],
    ) {
      await act(async () => fireEvent.press(getByTestId("mp-connect-account-row")));
      await act(async () => fireEvent.press(await findByTestId("mp-account-sheet-unlink")));
      await findByTestId("unlink-mp-sheet-confirm");
    }

    it("pide confirmación antes de desvincular", async () => {
      mockStatus = { data: LINKED, isError: false };
      const { getByTestId, queryByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);

      expect(queryByTestId("unlink-mp-sheet-confirm")).toBeNull();
      await openUnlinkSheet(getByTestId, findByTestId);
      expect(getByTestId("unlink-mp-sheet-confirm")).toBeTruthy();
      expect(mockUnlinkMutate).not.toHaveBeenCalled();
    });

    it("confirmar ejecuta el DELETE y avisa con un toast", async () => {
      mockStatus = { data: LINKED, isError: false };
      const { getByTestId, findByTestId, findByText } = await render(<PaymentsSettingsScreen />);

      await openUnlinkSheet(getByTestId, findByTestId);
      await act(async () => {
        fireEvent.press(getByTestId("unlink-mp-sheet-confirm"));
      });
      expect(mockUnlinkMutate).toHaveBeenCalledTimes(1);
      await act(async () => mockUnlinkOptions.onSuccess?.());
      expect(await findByText("Desvinculaste Mercado Pago.")).toBeTruthy();
    });

    it("Volver cierra sin desvincular", async () => {
      mockStatus = { data: LINKED, isError: false };
      const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);

      await openUnlinkSheet(getByTestId, findByTestId);
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

const VISA = {
  id: "card-visa",
  mpCardId: "mp-1",
  alias: "Personal",
  brand: "visa",
  last4: "3704",
  expMonth: 11,
  expYear: 2099,
  issuerName: "Banco Galicia",
  paymentType: "credit_card",
  isDefault: true,
  createdAt: "2026-10-01T10:00:00.000Z",
};
const MASTER = {
  ...VISA,
  id: "card-master",
  mpCardId: "mp-2",
  alias: null,
  brand: "master",
  last4: "8812",
  expMonth: 4,
  expYear: 2098,
  issuerName: "Santander",
  paymentType: "debit_card",
  isDefault: false,
  createdAt: "2026-10-05T10:00:00.000Z",
};
const EXPIRED_AMEX = {
  ...VISA,
  id: "card-amex",
  mpCardId: "mp-3",
  alias: null,
  brand: "amex",
  last4: "1005",
  expMonth: 8,
  expYear: 2020,
  issuerName: "American Express",
  isDefault: false,
};

describe("PaymentsSettingsScreen — Mis tarjetas (MOVO-101)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = { data: UNLINKED, isError: false };
    mockLink = { phase: "idle", error: null };
    mockCards = { data: [VISA, MASTER], isError: false };
    mockParams = { tab: "methods" };
    mockBalance = { isPending: false, isError: false, data: { pages: [{ balanceArs: 0 }] } };
  });

  it("sin tarjetas muestra el estado vacío con el beneficio y el botón de agregar (AC2)", async () => {
    mockCards = { data: [], isError: false };
    const { getByTestId, getByText } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("saved-cards-empty")).toBeTruthy();
    expect(getByText("Todavía no guardaste tarjetas")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("saved-cards-empty-add")));
    const { router } = jest.requireMock("expo-router");
    expect(router.push).toHaveBeenCalledWith("/profile/payments/add-card");
  });

  it("lista las tarjetas con nombre, número, banco, tipo, vencimiento y la predeterminada (AC2)", async () => {
    const { getByTestId, getByText, queryByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByText("Personal")).toBeTruthy();
    expect(getByText("Visa •••• 3704")).toBeTruthy();
    expect(getByTestId("saved-card-meta-card-visa").props.children).toBe("Galicia · Crédito · Vence 11/99");
    expect(getByText("Mastercard •••• 8812")).toBeTruthy();
    expect(getByTestId("saved-card-default-card-visa")).toBeTruthy();
    expect(queryByTestId("saved-card-default-card-master")).toBeNull();
    // El bloque de Mercado Pago sigue en la misma pantalla (AC1).
    expect(getByTestId("mp-connect-card-unlinked")).toBeTruthy();
  });

  it("muestra el logo del banco emisor y, sin banco o en Amex, el de la marca", async () => {
    mockCards = { data: [VISA, { ...MASTER, issuerName: null }, EXPIRED_AMEX], isError: false };
    const { getByTestId, queryByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("saved-card-bank-card-visa")).toBeTruthy();
    expect(queryByTestId("saved-card-brand-card-visa")).toBeNull();
    expect(getByTestId("saved-card-brand-card-master")).toBeTruthy();
    expect(getByTestId("saved-card-brand-card-amex")).toBeTruthy();
    expect(queryByTestId("saved-card-bank-card-amex")).toBeNull();
  });

  it("muestra skeleton mientras carga las tarjetas (AC8)", async () => {
    mockCards = { data: undefined, isError: false };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("saved-cards-loading")).toBeTruthy();
  });

  it("muestra el error de red con Reintentar (AC8)", async () => {
    mockCards = { data: undefined, isError: true, error: new ApiError(0, "INTERNAL_ERROR", "No se pudo conectar") };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);
    mockCardsRefetch.mockClear();
    await act(async () => fireEvent.press(getByTestId("saved-cards-retry")));
    expect(mockCardsRefetch).toHaveBeenCalled();
  });

  it("avisa cuando ninguna tarjeta está vigente", async () => {
    mockCards = { data: [EXPIRED_AMEX], isError: false };
    const { getByTestId } = await render(<PaymentsSettingsScreen />);
    expect(getByTestId("saved-cards-no-usable")).toBeTruthy();
    expect(getByTestId("saved-card-meta-card-amex").props.children).toBe("Crédito · Venció 08/20");
  });

  it("marca una tarjeta como predeterminada desde sus opciones (AC5)", async () => {
    const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);
    await act(async () => fireEvent.press(getByTestId("saved-card-row-card-master")));
    await act(async () => fireEvent.press(await findByTestId("card-options-make-default")));
    expect(mockSetDefault).toHaveBeenCalledWith("card-master");

    await act(async () => mockSetDefaultOptions.onSuccess?.({ ...MASTER, isDefault: true } as never));
    expect((await findByTestId("payments-toast"))).toBeTruthy();
  });

  it("la predeterminada no ofrece hacerse predeterminada", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(<PaymentsSettingsScreen />);
    await act(async () => fireEvent.press(getByTestId("saved-card-row-card-visa")));
    expect(await findByTestId("card-options-default-note")).toBeTruthy();
    expect(queryByTestId("card-options-make-default")).toBeNull();
  });

  it("elimina con confirmación y explica qué tarjeta pasa a ser la predeterminada (AC5)", async () => {
    const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);
    await act(async () => fireEvent.press(getByTestId("saved-card-row-card-visa")));
    await act(async () => fireEvent.press(await findByTestId("card-options-delete")));

    const body = await findByTestId("delete-card-body");
    expect(body.props.children.join("")).toContain("Vamos a usar Mastercard •••• 8812 en su lugar.");
    await act(async () => fireEvent.press(getByTestId("delete-card-confirm")));
    expect(mockDelete).toHaveBeenCalledWith(VISA);
  });

  it("con 409 CARD_IN_USE explica el motivo y no deja reintentar ni saca la tarjeta (AC5)", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(<PaymentsSettingsScreen />);
    await act(async () => fireEvent.press(getByTestId("saved-card-row-card-master")));
    await act(async () => fireEvent.press(await findByTestId("card-options-delete")));
    await findByTestId("delete-card-confirm");

    await act(async () =>
      mockDeleteOptions.onError?.(new ApiError(409, "CARD_IN_USE", "La tarjeta tiene una reserva")),
    );
    expect((await findByTestId("delete-card-error")).props).toBeTruthy();
    expect(getByTestId("delete-card-confirm").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("saved-card-row-card-master")).toBeTruthy();

    await act(async () => fireEvent.press(getByTestId("delete-card-back")));
    expect(queryByTestId("saved-cards-action-error")).toBeNull();
  });

  it("no vuelve a pedir las tarjetas en el primer foco: ya las trae la query al montar", async () => {
    mockCardsRefetch.mockClear();
    await render(<PaymentsSettingsScreen />);
    expect(mockCardsRefetch).not.toHaveBeenCalled();
  });

  it("renombra y quita el nombre de una tarjeta (AC10)", async () => {
    const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);
    await act(async () => fireEvent.press(getByTestId("saved-card-row-card-visa")));
    await act(async () => fireEvent.press(await findByTestId("card-options-rename")));

    const input = await findByTestId("rename-card-input");
    await act(async () => fireEvent.changeText(input, "  Tarjeta del trabajo "));
    await act(async () => fireEvent.press(getByTestId("rename-card-save")));
    expect(mockRename).toHaveBeenCalledWith({ id: "card-visa", alias: "Tarjeta del trabajo" }, expect.any(Object));

    await act(async () => fireEvent.press(getByTestId("rename-card-remove")));
    expect(mockRename).toHaveBeenLastCalledWith({ id: "card-visa", alias: null }, expect.any(Object));
  });

  it("muestra en el campo el motivo de un nombre rechazado por el backend (AC10)", async () => {
    const { getByTestId, findByTestId } = await render(<PaymentsSettingsScreen />);
    await act(async () => fireEvent.press(getByTestId("saved-card-row-card-visa")));
    await act(async () => fireEvent.press(await findByTestId("card-options-rename")));
    await act(async () => fireEvent.changeText(await findByTestId("rename-card-input"), "4111 1111 1111 1111"));
    await act(async () => fireEvent.press(getByTestId("rename-card-save")));

    const err = new ApiError(400, "VALIDATION_FAILED", "El nombre de la tarjeta no puede contener el número de la tarjeta.");
    const call = mockRename.mock.calls[0];
    await act(async () => {
      mockRenameOptions.onError?.(err);
      call[1].onError(err);
    });
    expect((await findByTestId("rename-card-input-error")).props.children).toBe(
      "El nombre de la tarjeta no puede contener el número de la tarjeta.",
    );
  });

  it("muestra el aviso de tarjeta guardada que llega desde el alta", async () => {
    mockParams = { tab: "methods", toast: 'Guardamos "Personal". Es tu predeterminada.' };
    const { findByText } = await render(<PaymentsSettingsScreen />);
    expect(await findByText('Guardamos "Personal". Es tu predeterminada.')).toBeTruthy();
  });
});
