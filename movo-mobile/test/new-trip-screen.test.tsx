import { act, fireEvent, render } from "@testing-library/react-native";
import NewTripScreen from "../app/(app)/carrier/trips/new";
import type { CreateTripInput } from "../src/api/trips-client";

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
}));

const mockCreateTripMutate = jest.fn();
const mockUseCreateTrip = jest.fn();

jest.mock("../src/hooks/use-trips", () => ({
  useCreateTrip: () => mockUseCreateTrip(),
}));

const FAKE_INPUT: CreateTripInput = {
  originAddress: "Av. Colón 1234, Córdoba",
  originLat: -31.4201,
  originLng: -64.1888,
  destinationAddress: "Av. San Martín 100, Villa María",
  destinationLat: -32.4104,
  destinationLng: -63.2404,
  departureAt: "2026-09-10T12:00:00.000Z",
  vehicleType: "Auto",
};

// El TripForm en sí ya tiene su propia cobertura completa (trip-form.test.tsx) —
// acá se testea solo la orquestación de la pantalla: mutación, mapeo de error de API
// y navegación de vuelta al éxito.
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

describe("NewTripScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCreateTrip.mockReturnValue({ mutate: mockCreateTripMutate, isPending: false });
  });

  it("llama a la mutación con el input del form y navega a Mis viajes con la confirmación de éxito", async () => {
    mockCreateTripMutate.mockImplementation((_input, { onSuccess }: any) => onSuccess());

    const { getByTestId } = await render(<NewTripScreen />);
    fireEvent.press(getByTestId("tf-stub-submit"));

    expect(mockCreateTripMutate).toHaveBeenCalledWith(FAKE_INPUT, expect.any(Object));
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: "/carrier/trips",
      params: { created: "1" },
    });
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it("muestra el mensaje amigable de CARRIER_NOT_VERIFIED ante un 403", async () => {
    const { ApiError } = require("@movo/shared/dist/errors/api-error");
    mockCreateTripMutate.mockImplementation((_input, { onError }: any) =>
      onError(new ApiError(403, "CARRIER_NOT_VERIFIED", "forbidden")),
    );

    const { getByTestId } = await render(<NewTripScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("tf-stub-submit"));
      await Promise.resolve();
    });

    expect(getByTestId("tf-stub-error").props.children).toBe(
      "Necesitás tener tu identidad verificada como transportista para declarar viajes.",
    );
  });

  it("el botón de back del header reemplaza al listado si no hay historial", async () => {
    mockCanGoBack.mockReturnValue(false);

    const { getByTestId } = await render(<NewTripScreen />);
    fireEvent.press(getByTestId("new-trip-back"));

    expect(mockRouterReplace).toHaveBeenCalledWith("/carrier/trips");
  });

  it("vuelve atrás al tocar el botón de back del header", async () => {
    mockCanGoBack.mockReturnValue(true);

    const { getByTestId } = await render(<NewTripScreen />);
    fireEvent.press(getByTestId("new-trip-back"));

    expect(mockRouterBack).toHaveBeenCalled();
  });
});
