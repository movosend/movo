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
  // MOVO-221 (fix de review, PR #168): declared es el estado real de un viaje recién
  // creado -- antes de este fix quedaba hardcodeado en ACTIVE y nunca ejercitaba el
  // bug real (el form no se mostraba para un viaje declared, ver el test de abajo).
  status: TripStatus.DECLARED,
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
  cancelledAt: null,
  recurrenceWeekdays: null,
  recurrenceUntil: null,
  seriesId: null,
  generatedFromTripId: null,
  isSeriesHead: true,
  hasAcceptedPackages: false,
  acceptedPackagesCount: 0,
  executablePackagesCount: 0,
};

// El TripForm en sí ya tiene su propia cobertura completa (trip-form.test.tsx) —
// acá se testea solo la orquestación de la pantalla: precarga, bloqueo por AC4,
// mutación y navegación.
jest.mock("../components/trips/trip-form", () => {
  const { Pressable, Text } = require("react-native");
  return {
    TripForm: (props: {
      onSubmit: (i: CreateTripInput) => void;
      error: string | null;
      recurrenceError?: string | null;
      recurringSubmitLabel?: string;
      mode?: string;
      recurrenceReadOnlyReason?: string | null;
      initialValues?: { recurrence?: unknown };
    }) => (
      <>
        <Pressable testID="tf-stub-submit" onPress={() => props.onSubmit(FAKE_INPUT)} />
        <Text testID="tf-stub-error">{props.error}</Text>
        <Text testID="tf-stub-recurrence-error">{props.recurrenceError}</Text>
        <Text testID="tf-stub-props">
          {JSON.stringify({
            recurringSubmitLabel: props.recurringSubmitLabel ?? null,
            mode: props.mode ?? null,
            recurrenceReadOnlyReason: props.recurrenceReadOnlyReason ?? null,
            recurrence: props.initialValues?.recurrence ?? null,
          })}
        </Text>
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
      data: { ...TRIP, hasAcceptedPackages: true, acceptedPackagesCount: 1 },
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

  it("MOVO-221 (fix de review, PR #168): también bloquea un viaje completed", async () => {
    mockUseTrip.mockReturnValue({
      data: { ...TRIP, status: TripStatus.COMPLETED },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<EditTripScreen />);

    expect(getByTestId("edit-trip-not-active")).toBeTruthy();
    expect(queryByTestId("tf-stub-submit")).toBeNull();
  });

  it("MOVO-221 (fix de review, PR #168): un viaje declared (recién creado) SÍ muestra el form editable", async () => {
    mockUseTrip.mockReturnValue({ data: TRIP, isLoading: false, isError: false, refetch: jest.fn() });

    const { getByTestId, queryByTestId } = await render(<EditTripScreen />);

    expect(getByTestId("tf-stub-submit")).toBeTruthy();
    expect(queryByTestId("edit-trip-not-active")).toBeNull();
  });

  it("MOVO-221 (fix de review, PR #168): un viaje active también muestra el form editable", async () => {
    mockUseTrip.mockReturnValue({
      data: { ...TRIP, status: TripStatus.ACTIVE },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<EditTripScreen />);

    expect(getByTestId("tf-stub-submit")).toBeTruthy();
    expect(queryByTestId("edit-trip-not-active")).toBeNull();
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
      "Este viaje ya tiene paquetes aceptados, así que no se puede modificar ni cancelar. Si necesitás cancelar, hacelo desde cada envío.",
    );
  });

  describe("MOVO-266: viajes recurrentes", () => {
    const loaded = (data: object) => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
    const props = (getByTestId: (id: string) => any) => JSON.parse(getByTestId("tf-stub-props").props.children);

    it("precarga la recurrencia y edita todo el viaje si no tiene paquetes", async () => {
      mockUseTrip.mockReturnValue(loaded({ ...TRIP, recurrenceWeekdays: [5], recurrenceUntil: "2026-12-18" }));

      const { getByTestId } = await render(<EditTripScreen />);

      expect(props(getByTestId)).toEqual(
        expect.objectContaining({ mode: "full", recurrence: { weekdays: [5], until: "2026-12-18" } }),
      );
    });

    it("con paquetes aceptados, el vigente de una serie abre el form en modo recurrence-only", async () => {
      mockUseTrip.mockReturnValue(
        loaded({ ...TRIP, recurrenceWeekdays: [5], hasAcceptedPackages: true, acceptedPackagesCount: 1 }),
      );

      const { getByTestId, queryByTestId } = await render(<EditTripScreen />);

      expect(queryByTestId("edit-trip-blocked")).toBeNull();
      expect(props(getByTestId).mode).toBe("recurrence-only");
    });

    it("con paquetes y un viaje que ya tiene el siguiente declarado, sigue bloqueado", async () => {
      mockUseTrip.mockReturnValue(
        loaded({ ...TRIP, recurrenceWeekdays: [5], isSeriesHead: false, hasAcceptedPackages: true }),
      );

      const { getByTestId } = await render(<EditTripScreen />);

      expect(getByTestId("edit-trip-blocked")).toBeTruthy();
    });

    it("sin paquetes y sin ser el vigente de la serie, la recurrencia es de solo lectura", async () => {
      mockUseTrip.mockReturnValue(loaded({ ...TRIP, recurrenceWeekdays: [5], isSeriesHead: false }));

      const { getByTestId } = await render(<EditTripScreen />);

      expect(props(getByTestId).recurrenceReadOnlyReason).toMatch(/ya tiene el siguiente declarado/);
    });

    it("un viaje vencido no muestra el form", async () => {
      mockUseTrip.mockReturnValue(loaded({ ...TRIP, status: "expired" }));

      const { getByTestId } = await render(<EditTripScreen />);

      expect(getByTestId("edit-trip-not-active")).toBeTruthy();
    });

    it("el tope de series se muestra inline en la card", async () => {
      const { ApiError } = require("@movo/shared/dist/errors/api-error");
      mockUseTrip.mockReturnValue(loaded(TRIP));
      mockUpdateTripMutate.mockImplementation((_args, { onError }: any) =>
        onError(new ApiError(409, "RECURRING_SERIES_LIMIT", "limit")),
      );

      const { getByTestId } = await render(<EditTripScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("tf-stub-submit"));
        await Promise.resolve();
      });

      expect(getByTestId("tf-stub-recurrence-error").props.children).toBe(
        "Ya tenés 3 viajes que se repiten. Dejá de repetir alguno para sumar otro.",
      );
    });
  });
});
