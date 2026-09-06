import { fireEvent, render } from "@testing-library/react-native";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const mockUseActiveTripMatchAlert = jest.fn();
jest.mock("../src/hooks/use-active-trip-match-alert", () => ({
  useActiveTripMatchAlert: () => mockUseActiveTripMatchAlert(),
}));

import { TripMatchAlertBanner } from "../components/trips/trip-match-alert-banner";

describe("TripMatchAlertBanner (MOVO-163)", () => {
  afterEach(() => jest.clearAllMocks());

  it("no renderiza nada sin una alerta activa", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({ alert: null, dismiss: jest.fn() });

    const { queryByTestId } = await render(<TripMatchAlertBanner />);

    expect(queryByTestId("trip-match-alert-banner")).toBeNull();
  });

  it("muestra el mensaje en singular con un solo match nuevo", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", newCount: 1 },
      dismiss: jest.fn(),
    });

    const { getByText } = await render(<TripMatchAlertBanner />);

    expect(getByText("1 paquete nuevo compatible con tu viaje")).toBeTruthy();
  });

  it("muestra el mensaje en plural con más de un match nuevo", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", newCount: 3 },
      dismiss: jest.fn(),
    });

    const { getByText } = await render(<TripMatchAlertBanner />);

    expect(getByText("3 paquetes nuevos compatibles con tu viaje")).toBeTruthy();
  });

  it("tocar el cuerpo navega al feed filtrado por ese viaje y descarta la alerta", async () => {
    const dismiss = jest.fn();
    mockUseActiveTripMatchAlert.mockReturnValue({ alert: { tripId: "trip-1", newCount: 2 }, dismiss });

    const { getByTestId } = await render(<TripMatchAlertBanner />);
    fireEvent.press(getByTestId("trip-match-alert-banner"));

    expect(dismiss).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/(app)/(tabs)/transport",
      params: { tripId: "trip-1" },
    });
  });

  it("tocar la X descarta la alerta sin navegar", async () => {
    const dismiss = jest.fn();
    mockUseActiveTripMatchAlert.mockReturnValue({ alert: { tripId: "trip-1", newCount: 2 }, dismiss });

    const { getByTestId } = await render(<TripMatchAlertBanner />);
    fireEvent.press(getByTestId("trip-match-alert-dismiss"));

    expect(dismiss).toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("se auto-descarta a los 8 segundos", async () => {
    jest.useFakeTimers();
    const dismiss = jest.fn();
    mockUseActiveTripMatchAlert.mockReturnValue({ alert: { tripId: "trip-1", newCount: 1 }, dismiss });

    await render(<TripMatchAlertBanner />);
    jest.advanceTimersByTime(8_000);

    expect(dismiss).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
