import { act, fireEvent, render } from "@testing-library/react-native";
import EditTripScreen from "../app/(app)/carrier/trips/[id]/edit";
import { TripStatus, type CreateTripInput, type TripWithAcceptedPackages } from "../src/api/trips-client";

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    back: () => mockRouterBack(),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    canGoBack: () => mockCanGoBack(),
    push: jest.fn(),
  },
  useLocalSearchParams: () => ({ id: "trip-1" }),
}));

const mockUseTrip = jest.fn();
const mockUpdateTripMutate = jest.fn();
const mockUseUpdateTrip = jest.fn();

jest.mock("../src/hooks/use-trips", () => ({
  useTrip: (id: string | undefined) => mockUseTrip(id),
  useUpdateTrip: () => mockUseUpdateTrip(),
}));

const FAKE_INPUT: CreateTripInput = {
  originAddress: "Av. Colón 1234, Córdoba",
  originLat: -31.4201,
  originLng: -64.1888,
  destinationAddress: "Av. San Martín 100, Villa María",
  destinationLat: -32.4104,
  destinationLng: -63.2404,
  departureAt: "2026-09-10T12:00:00.000Z",
  vehicleType: "Camioneta",
};

const TRIP: TripWithAcceptedPackages = {
  id: "trip-1",
  carrierId: "carrier-1",
  ...FAKE_INPUT,
  status: TripStatus.ACTIVE,
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
  hasAcceptedPackages: false,
};

// El TripForm en sí ya tiene su propia cobertura completa (trip-form.test.tsx) —
// acá se testea solo la orquestación de la pantalla: precarga, bloqueo por AC4,
// mutación y navegación.
jest.mock("../components/trips/trip-form", () => {
  const { Pressable, Text } = require("react-native");
  return {
    TripForm: ({ onSubmit, error }: { onSubmit: (i: CreateTripInput) => void; error: string | null }) => (
      <>
        <Pressable testID="tf-stub-submit" onPress={() => onSubmit(FAKE_INPUT)} />
        <Text testID="tf-stub-error">{error}</Text>
      </>
    ),
  };
});

describe("EditTripScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUpdateTrip.mockReturnValue({ mutate: mockUpdateTripMutate, isPending: false });
  });

  it("muestra el estado de error con reintento", async () => {
    const refetch = jest.fn();
    mockUseTrip.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    const { getByTestId } = await render(<EditTripScreen />);
    fireEvent.press(getByTestId("edit-trip-retry"));

    expect(refetch).toHaveBeenCalled();
  });

  it("AC4: muestra el mensaje bloqueado en vez del form si el viaje tiene paquetes aceptados", async () => {
    mockUseTrip.mockReturnValue({
      data: { ...TRIP, hasAcceptedPackages: true },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<EditTripScreen />);

    expect(getByTestId("edit-trip-blocked")).toBeTruthy();
    expect(queryByTestId("tf-stub-submit")).toBeNull();
  });

  it("hallazgo de review (PR #120): muestra el mensaje bloqueado si el viaje ya no está activo", async () => {
    mockUseTrip.mockReturnValue({
      data: { ...TRIP, status: TripStatus.CANCELLED },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<EditTripScreen />);

    expect(getByTestId("edit-trip-not-active")).toBeTruthy();
    expect(queryByTestId("tf-stub-submit")).toBeNull();
  });

  it("llama a la mutación con id + input del form y vuelve atrás al éxito", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockUseTrip.mockReturnValue({ data: TRIP, isLoading: false, isError: false, refetch: jest.fn() });
    mockUpdateTripMutate.mockImplementation((_args, { onSuccess }: any) => onSuccess());

    const { getByTestId } = await render(<EditTripScreen />);
    fireEvent.press(getByTestId("tf-stub-submit"));

    expect(mockUpdateTripMutate).toHaveBeenCalledWith({ id: "trip-1", body: FAKE_INPUT }, expect.any(Object));
    expect(mockRouterBack).toHaveBeenCalled();
  });

  it("muestra el mensaje amigable de TRIP_HAS_ACCEPTED_PACKAGES ante un 409 (carrera real)", async () => {
    const { ApiError } = require("@movo/shared/dist/errors/api-error");
    mockUseTrip.mockReturnValue({ data: TRIP, isLoading: false, isError: false, refetch: jest.fn() });
    mockUpdateTripMutate.mockImplementation((_args, { onError }: any) =>
      onError(new ApiError(409, "TRIP_HAS_ACCEPTED_PACKAGES", "conflict")),
    );

    const { getByTestId } = await render(<EditTripScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("tf-stub-submit"));
      await Promise.resolve();
    });

    expect(getByTestId("tf-stub-error").props.children).toBe(
      "Este viaje ya tiene paquetes aceptados y no se puede modificar ni cancelar directamente.",
    );
  });
});
