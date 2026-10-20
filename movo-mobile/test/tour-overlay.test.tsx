import { act, fireEvent, render } from "@testing-library/react-native";
import { TourOverlay, TOUR_ANCHOR_TIMEOUT_MS } from "../components/tour/tour-overlay";
import { useBlockingGatesStore } from "../src/store/blocking-gates-store";
import { useTourStore } from "../src/store/tour-store";

const mockNavigate = jest.fn();
let mockPathname = "/home";
jest.mock("expo-router", () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
  usePathname: () => mockPathname,
}));

const mockRecordTour = jest.fn();
jest.mock("../src/hooks/use-record-tour", () => ({
  useRecordTour: () => ({ mutate: mockRecordTour }),
}));

const RECT = { x: 20, y: 140, width: 350, height: 100 };

function registerAnchors(ids: string[]) {
  for (const id of ids) {
    useTourStore.getState().registerAnchor(id, {
      measure: () => Promise.resolve(RECT),
      radius: 20,
      padding: 6,
    });
  }
}

const HOME_ANCHORS = ["home-send-cta", "home-recent-activity", "home-chat-button", "tab-transport"];
const TRANSPORT_ANCHORS = ["transport-my-trips", "transport-radius-filters", "transport-first-row", "transport-my-offers"];

describe("TourOverlay (MOVO-169)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/home";
    useTourStore.setState({ active: null, anchors: {}, pending: [], pendingLoaded: true });
    useBlockingGatesStore.setState({ mounted: true, gateVisible: false, tripMatchVisible: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sin tour activo no renderiza nada", async () => {
    const { queryByTestId } = await render(<TourOverlay />);
    expect(queryByTestId("tour-overlay")).toBeNull();
  });

  it("paso 1 modal con el nombre, 'Empezar' y 'Omitir tutorial'; después un tooltip sobre el ancla", async () => {
    registerAnchors(HOME_ANCHORS);
    useTourStore.getState().startTour("first_steps", { context: { firstName: "Pauli", canBrowse: false } });

    const { getByTestId, getByText, findByTestId, queryByTestId } = await render(<TourOverlay />);

    expect(getByTestId("tour-modal")).toBeTruthy();
    expect(getByText("PASO 1 DE 6")).toBeTruthy();
    expect(getByText("¡Ya estás adentro, Pauli!")).toBeTruthy();
    expect(getByText("Empezar")).toBeTruthy();
    expect(getByText("Omitir tutorial")).toBeTruthy();

    await fireEvent.press(getByTestId("tour-primary"));

    expect(await findByTestId("tour-tooltip")).toBeTruthy();
    expect(queryByTestId("tour-modal")).toBeNull();
    expect(getByText("PASO 2 DE 6")).toBeTruthy();
    expect(getByText("Publicá un envío")).toBeTruthy();
    expect(getByText("Omitir")).toBeTruthy();
    expect(getByText("Anterior")).toBeTruthy();
    expect(getByText("Siguiente")).toBeTruthy();

    await fireEvent.press(getByTestId("tour-prev"));
    expect(await findByTestId("tour-modal")).toBeTruthy();
  });

  it("Omitir cierra el tour y registra 'skipped'", async () => {
    useTourStore.getState().startTour("first_steps", { context: { canBrowse: false } });
    const { getByTestId, queryByTestId } = await render(<TourOverlay />);

    await fireEvent.press(getByTestId("tour-skip"));

    expect(queryByTestId("tour-overlay")).toBeNull();
    expect(mockRecordTour).toHaveBeenCalledWith({ tourId: "first_steps", version: 1, outcome: "skipped" });
  });

  it("'¡Entendido!' en el último paso registra 'completed'", async () => {
    mockPathname = "/transport";
    registerAnchors(TRANSPORT_ANCHORS);
    useTourStore.getState().startTour("carrier", { context: { canBrowse: true, hasFeed: true } });
    const { getByTestId, findByText } = await render(<TourOverlay />);

    for (let i = 0; i < 4; i++) {
      await fireEvent.press(getByTestId("tour-primary"));
      await findByText(`PASO ${i + 2} DE 5`);
    }
    await findByText("¡Entendido!");
    await fireEvent.press(getByTestId("tour-primary"));

    expect(mockRecordTour).toHaveBeenCalledWith({ tourId: "carrier", version: 1, outcome: "completed" });
    expect(useTourStore.getState().active).toBeNull();
  });

  it("relanzado a mano no escribe UserTour al terminar ni al omitir", async () => {
    useTourStore.getState().startTour("first_steps", { manual: true });
    const { getByTestId } = await render(<TourOverlay />);

    await fireEvent.press(getByTestId("tour-skip"));

    expect(useTourStore.getState().active).toBeNull();
    expect(mockRecordTour).not.toHaveBeenCalled();
  });

  it("si el ancla no aparece en ~1,5s el paso se saltea y el total se recalcula", async () => {
    jest.useFakeTimers();
    mockPathname = "/transport";
    registerAnchors(TRANSPORT_ANCHORS.filter((id) => id !== "transport-first-row"));
    useTourStore.getState().startTour("carrier", { context: { canBrowse: true, hasFeed: true } });
    useTourStore.setState((state) => ({ active: state.active && { ...state.active, index: 3 } }));

    const { findByText, queryByText } = await render(<TourOverlay />);
    expect(queryByText("Mirá el desvío y el pago")).toBeNull();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(TOUR_ANCHOR_TIMEOUT_MS + 200);
    });

    expect(await findByText("Seguí tus ofertas")).toBeTruthy();
    expect(await findByText("PASO 4 DE 4")).toBeTruthy();
  });

  it("navega a la pantalla del paso cuando no está en ella", async () => {
    mockPathname = "/profile";
    useTourStore.getState().startTour("carrier", { manual: true, context: { canBrowse: true } });

    await render(<TourOverlay />);

    expect(mockNavigate).toHaveBeenCalledWith("/transport");
  });

  it("espera oculto mientras hay una pantalla bloqueante encima", async () => {
    useBlockingGatesStore.setState({ gateVisible: true });
    useTourStore.getState().startTour("first_steps");

    const { queryByTestId } = await render(<TourOverlay />);

    expect(queryByTestId("tour-overlay")).toBeNull();
    expect(useTourStore.getState().active).not.toBeNull();
  });
});
