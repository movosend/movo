import type { TransactionListItem } from "@movo/shared/dist/types/transaction";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import PaymentsHistoryScreen from "../app/(app)/profile/payments/history";
import { dateRangeForPreset } from "../src/lib/transaction-format";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockFocusCallback: (() => void) | null = null;

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  },
  // Se guarda el callback para poder simular "volver a la pantalla" varias veces.
  useFocusEffect: (cb: () => void) => {
    mockFocusCallback = cb;
  },
}));

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable } = require("react-native");
  const MockDateTimePicker = (props: {
    testID?: string;
    onChange: (event: { type: string }, date?: Date) => void;
  }) => (
    <Pressable testID={props.testID} onPress={() => props.onChange({ type: "set" }, new Date(2026, 9, 5))} />
  );
  return { __esModule: true, default: MockDateTimePicker, DateTimePickerAndroid: { open: jest.fn() } };
});

const mockUseTransactions = jest.fn();
jest.mock("../src/hooks/use-transactions", () => ({
  ...jest.requireActual("../src/hooks/use-transactions"),
  useTransactions: (...args: unknown[]) => mockUseTransactions(...args),
}));

const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();

function tx(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return {
    id: "tx-1",
    shipmentId: "00000000-0000-4000-8000-000000048215",
    date: "2026-10-13T15:10:00.000Z",
    amountArs: 12450,
    status: "reserved",
    refundedAmountArs: null,
    card: { brand: "visa", last4: "4242" },
    ...overrides,
  };
}

const SENDER_ITEMS: TransactionListItem[] = [
  tx({ id: "s-reserved", status: "reserved" }),
  tx({ id: "s-completed", shipmentId: "00000000-0000-4000-8000-000000047102", status: "completed", amountArs: 8900 }),
  tx({
    id: "s-refunded",
    shipmentId: "00000000-0000-4000-8000-000000046380",
    status: "refunded",
    amountArs: 5200,
    refundedAmountArs: 1500,
    card: { brand: "master", last4: "1881" },
  }),
  tx({ id: "s-disputed", shipmentId: "00000000-0000-4000-8000-000000045911", status: "disputed", amountArs: 15000 }),
  tx({
    id: "s-released",
    shipmentId: "00000000-0000-4000-8000-000000044077",
    status: "released",
    amountArs: 7300,
    date: "2026-09-28T19:40:00.000Z",
  }),
];

const CARRIER_ITEMS: TransactionListItem[] = [
  tx({ id: "c-reserved", card: undefined }),
  tx({ id: "c-completed", shipmentId: "00000000-0000-4000-8000-000000047102", status: "completed", card: undefined }),
];

interface QueryState {
  items?: TransactionListItem[];
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isFetchNextPageError?: boolean;
}

/** Cada rol tiene su propio set de datos, como la query real (la key lleva el rol y los filtros). */
let mockState: Record<"sender" | "carrier", QueryState>;

function queryFor(role: "sender" | "carrier") {
  const state = mockState[role];
  return {
    data: state.items ? { pages: [{ items: state.items, nextCursor: state.hasNextPage ? "next" : null }] } : undefined,
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
    error: state.error,
    hasNextPage: state.hasNextPage ?? false,
    isFetchingNextPage: state.isFetchingNextPage ?? false,
    isFetchNextPageError: state.isFetchNextPageError ?? false,
    refetch: mockRefetch,
    fetchNextPage: mockFetchNextPage,
  };
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

function lastQueryArgs(): { role: string; filters: { statuses: string[]; from: string | null; to: string | null } } {
  const [role, filters] = mockUseTransactions.mock.calls[mockUseTransactions.mock.calls.length - 1];
  return { role, filters };
}

describe("PaymentsHistoryScreen (MOVO-304)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    mockState = { sender: { items: SENDER_ITEMS }, carrier: { items: CARRIER_ITEMS } };
    mockUseTransactions.mockImplementation((role: "sender" | "carrier") => queryFor(role));
  });

  describe("Pagos", () => {
    it("arranca en la tab Pagos (role=sender) sin filtros", async () => {
      await render(<PaymentsHistoryScreen />);
      expect(lastQueryArgs()).toEqual({ role: "sender", filters: { statuses: [], from: null, to: null } });
    });

    it("muestra cada fila con referencia, tarjeta, fecha, monto y pill de estado (AC4/AC6)", async () => {
      const { getByTestId, getByText, getAllByText } = await render(<PaymentsHistoryScreen />);

      expect(getByText("Envío #MOVO-48215")).toBeTruthy();
      expect(getAllByText("Visa •••• 4242 · 13 oct").length).toBeGreaterThan(0);
      expect(getByText("$12.450")).toBeTruthy();
      expect(within(getByTestId("transaction-pill-s-reserved")).getByText("Reservado")).toBeTruthy();
      expect(within(getByTestId("transaction-pill-s-completed")).getByText("Completado")).toBeTruthy();
      expect(within(getByTestId("transaction-pill-s-refunded")).getByText("Reembolsado")).toBeTruthy();
      expect(within(getByTestId("transaction-pill-s-disputed")).getByText("En disputa")).toBeTruthy();
      expect(within(getByTestId("transaction-pill-s-released")).getByText("Liberado")).toBeTruthy();
      expect(getByText("Mastercard •••• 1881 · 13 oct")).toBeTruthy();
    });

    it("una transacción con reembolso muestra 'Reembolso de $X' en la fila (AC4)", async () => {
      const { getByTestId, queryByTestId } = await render(<PaymentsHistoryScreen />);
      expect(within(getByTestId("transaction-refund-s-refunded")).getByText("Reembolso de $1.500")).toBeTruthy();
      expect(queryByTestId("transaction-refund-s-reserved")).toBeNull();
    });

    it("agrupa por mes, del más reciente al más viejo (AC3)", async () => {
      const { getByText } = await render(<PaymentsHistoryScreen />);
      expect(getByText("Octubre 2026")).toBeTruthy();
      expect(getByText("Septiembre 2026")).toBeTruthy();
    });

    it("tocar una fila abre el detalle con el rol de la tab (AC5)", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);
      await press(getByTestId("transaction-row-s-completed"));
      expect(mockPush).toHaveBeenCalledWith({
        pathname: "/profile/payments/history/[id]",
        params: { id: "s-completed", role: "sender" },
      });
    });

    it("el contador es un mínimo si hay más páginas y 'Cargar más' pide la siguiente (AC3)", async () => {
      mockState.sender = { items: SENDER_ITEMS, hasNextPage: true };
      const { getByTestId } = await render(<PaymentsHistoryScreen />);

      expect(getByTestId("history-count")).toHaveTextContent("5+ pagos");
      await press(getByTestId("transactions-load-more"));
      expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
    });

    it("sin más páginas no hay 'Cargar más' y el contador es exacto", async () => {
      const { getByTestId, queryByTestId } = await render(<PaymentsHistoryScreen />);
      expect(queryByTestId("transactions-load-more")).toBeNull();
      expect(getByTestId("history-count")).toHaveTextContent("5 pagos");
    });

    it("mientras carga la siguiente página el botón no se puede volver a tocar", async () => {
      mockState.sender = { items: SENDER_ITEMS, hasNextPage: true, isFetchingNextPage: true };
      const { getByTestId, getByText } = await render(<PaymentsHistoryScreen />);
      expect(getByText("Cargando…")).toBeTruthy();
      await press(getByTestId("transactions-load-more"));
      expect(mockFetchNextPage).not.toHaveBeenCalled();
    });
  });

  describe("Cobros", () => {
    it("cambiar de tab consulta role=carrier (AC2)", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);
      await press(getByTestId("history-tab-carrier"));
      expect(lastQueryArgs().role).toBe("carrier");
    });

    it("'Completado' se muestra como 'Cobrado' y no hay tarjeta en la fila (AC6)", async () => {
      const { getByTestId, getByText, queryByText } = await render(<PaymentsHistoryScreen />);
      await press(getByTestId("history-tab-carrier"));

      expect(within(getByTestId("transaction-pill-c-completed")).getByText("Cobrado")).toBeTruthy();
      expect(queryByText("Completado")).toBeNull();
      expect(within(getByTestId("transaction-pill-c-reserved")).getByText("Reservado")).toBeTruthy();
      expect(getByText("Se acredita al entregar · 13 oct")).toBeTruthy();
      expect(queryByText(/••••/)).toBeNull();
      expect(getByTestId("history-count")).toHaveTextContent("2 cobros");
    });

    it("el detalle de un cobro se abre con role=carrier", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);
      await press(getByTestId("history-tab-carrier"));
      await press(getByTestId("transaction-row-c-completed"));
      expect(mockPush).toHaveBeenCalledWith({
        pathname: "/profile/payments/history/[id]",
        params: { id: "c-completed", role: "carrier" },
      });
    });
  });

  describe("filtros", () => {
    it("elegir estados y un atajo de fechas cambia la query (AC8/AC9)", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);

      await press(getByTestId("history-filter-status"));
      await press(getByTestId("transaction-filters-status-refunded"));
      await press(getByTestId("transaction-filters-status-disputed"));
      await press(getByTestId("transaction-filters-preset-thisMonth"));
      await press(getByTestId("transaction-filters-apply"));

      const { from, to } = dateRangeForPreset("thisMonth");
      expect(lastQueryArgs().filters).toEqual({ statuses: ["refunded", "disputed"], from, to });
      // Se mandan como YYYY-MM-DD, sin convertir husos.
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("la selección manual desde/hasta manda YYYY-MM-DD", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);

      await press(getByTestId("history-filter-dates"));
      await press(getByTestId("transaction-filters-from"));
      await press(getByTestId("transaction-filters-picker"));
      await press(getByTestId("transaction-filters-apply"));

      const { filters } = lastQueryArgs();
      expect(filters.from).toBe("2026-10-05");
      expect(filters.statuses).toEqual([]);
    });

    it("'Todos' limpia la selección de estados dentro de la hoja", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);

      await press(getByTestId("history-filter-status"));
      await press(getByTestId("transaction-filters-status-released"));
      await press(getByTestId("transaction-filters-status-all"));
      await press(getByTestId("transaction-filters-apply"));

      expect(lastQueryArgs().filters.statuses).toEqual([]);
    });

    it("los filtros activos se ven como etiquetas removibles y hay 'Limpiar' (AC8)", async () => {
      const { getByTestId, queryByTestId } = await render(<PaymentsHistoryScreen />);

      await press(getByTestId("history-filter-status"));
      await press(getByTestId("transaction-filters-status-disputed"));
      await press(getByTestId("transaction-filters-status-released"));
      await press(getByTestId("transaction-filters-preset-last30"));
      await press(getByTestId("transaction-filters-apply"));

      expect(within(getByTestId("history-chip-status-disputed")).getByText("En disputa")).toBeTruthy();
      expect(within(getByTestId("history-chip-status-released")).getByText("Liberado")).toBeTruthy();
      expect(getByTestId("history-chip-dates")).toBeTruthy();

      await press(getByTestId("history-chip-status-disputed"));
      expect(lastQueryArgs().filters.statuses).toEqual(["released"]);
      expect(queryByTestId("history-chip-status-disputed")).toBeNull();

      await press(getByTestId("history-chip-dates"));
      expect(lastQueryArgs().filters.from).toBeNull();
      expect(lastQueryArgs().filters.to).toBeNull();

      await press(getByTestId("history-clear"));
      expect(lastQueryArgs().filters).toEqual({ statuses: [], from: null, to: null });
      expect(queryByTestId("history-clear")).toBeNull();
    });

    it("cada tab conserva sus propios filtros (AC2)", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);

      await press(getByTestId("history-filter-status"));
      await press(getByTestId("transaction-filters-status-disputed"));
      await press(getByTestId("transaction-filters-apply"));
      expect(lastQueryArgs()).toMatchObject({ role: "sender", filters: { statuses: ["disputed"] } });

      await press(getByTestId("history-tab-carrier"));
      expect(lastQueryArgs()).toEqual({ role: "carrier", filters: { statuses: [], from: null, to: null } });

      await press(getByTestId("history-tab-sender"));
      expect(lastQueryArgs()).toMatchObject({ role: "sender", filters: { statuses: ["disputed"] } });
    });

    it("la hoja se abre con los filtros ya aplicados", async () => {
      const { getByTestId } = await render(<PaymentsHistoryScreen />);

      await press(getByTestId("history-filter-status"));
      await press(getByTestId("transaction-filters-status-refunded"));
      await press(getByTestId("transaction-filters-apply"));

      // Con filtros activos las etiquetas solo se quitan: el botón "Filtros" reabre la hoja.
      await press(getByTestId("history-filter-open"));
      expect(getByTestId("transaction-filters-status-refunded").props.accessibilityState.selected).toBe(true);
      expect(getByTestId("transaction-filters-status-all").props.accessibilityState.selected).toBe(false);
    });
  });

  describe("estados de pantalla (AC13)", () => {
    it("muestra el skeleton mientras carga", async () => {
      mockState.sender = { isPending: true };
      const { getByTestId, queryByTestId } = await render(<PaymentsHistoryScreen />);
      expect(getByTestId("transactions-loading")).toBeTruthy();
      expect(queryByTestId("transactions-list")).toBeNull();
    });

    it("vacío de Pagos con la acción 'Enviar un paquete'", async () => {
      mockState.sender = { items: [] };
      const { getByTestId, getByText } = await render(<PaymentsHistoryScreen />);

      expect(getByText("Todavía no hiciste pagos")).toBeTruthy();
      await press(getByTestId("transactions-empty-action-sender"));
      expect(mockPush).toHaveBeenCalledWith("/send");
    });

    it("vacío de Cobros con la acción 'Ver envíos disponibles'", async () => {
      mockState.carrier = { items: [] };
      const { getByTestId, getByText } = await render(<PaymentsHistoryScreen />);
      await press(getByTestId("history-tab-carrier"));

      expect(getByText("Todavía no cobraste")).toBeTruthy();
      await press(getByTestId("transactions-empty-action-carrier"));
      expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)/transport");
    });

    it("sin resultados con filtros: mensaje por tab y 'Limpiar filtros' vuelve a pedir sin filtros", async () => {
      // Con cualquier estado filtrado el backend no devuelve nada.
      mockUseTransactions.mockImplementation((role: "sender" | "carrier", filters: { statuses: string[] }) => {
        const query = queryFor(role);
        return filters.statuses.length > 0 ? { ...query, data: { pages: [{ items: [], nextCursor: null }] } } : query;
      });
      const { getByTestId, getByText, queryByTestId } = await render(<PaymentsHistoryScreen />);
      await press(getByTestId("history-filter-status"));
      await press(getByTestId("transaction-filters-status-disputed"));
      await press(getByTestId("transaction-filters-apply"));

      expect(getByText("Ningún pago coincide")).toBeTruthy();
      expect(queryByTestId("transactions-empty-sender")).toBeNull();

      await press(getByTestId("transactions-clear-filters"));
      expect(lastQueryArgs().filters).toEqual({ statuses: [], from: null, to: null });
    });

    it("error de carga con 'Reintentar' y mensaje por friendlyErrorMessage", async () => {
      mockState.sender = { isError: true, error: new ApiError(500, "INTERNAL_ERROR", "boom") };
      const { getByTestId, getByText } = await render(<PaymentsHistoryScreen />);

      expect(getByText("Ocurrió un error inesperado. Intentá de nuevo en unos minutos.")).toBeTruthy();
      await press(getByTestId("transactions-error-retry"));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it("un error con la lista ya cargada no la reemplaza por la pantalla de error", async () => {
      mockState.sender = { items: SENDER_ITEMS, isError: true, error: new ApiError(500, "INTERNAL_ERROR", "boom") };
      const { getByTestId, queryByTestId } = await render(<PaymentsHistoryScreen />);
      expect(getByTestId("transactions-list")).toBeTruthy();
      expect(queryByTestId("transactions-error")).toBeNull();
    });

    it("un fallo al cargar más páginas ofrece reintentar", async () => {
      mockState.sender = { items: SENDER_ITEMS, hasNextPage: true, isFetchNextPageError: true };
      const { getByTestId, getByText } = await render(<PaymentsHistoryScreen />);
      expect(getByText("Reintentar")).toBeTruthy();
      await press(getByTestId("transactions-load-more"));
      expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
    });
  });

  describe("foco", () => {
    it("no refetchea en el primer foco y sí al volver a la pantalla", async () => {
      await render(<PaymentsHistoryScreen />);
      expect(mockFocusCallback).not.toBeNull();

      await act(async () => {
        mockFocusCallback!();
      });
      expect(mockRefetch).not.toHaveBeenCalled();

      await act(async () => {
        mockFocusCallback!();
      });
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  it("el botón de volver navega hacia atrás", async () => {
    const { getByTestId } = await render(<PaymentsHistoryScreen />);
    await press(getByTestId("history-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
