import { act, fireEvent, render } from "@testing-library/react-native";
import NewTripScreen from "../app/(app)/carrier/trips/new";
import type { CreateTripInput } from "../src/api/trips-client";

// MOVO-117: la checklist de requisitos ante un 403 se testea aparte; acá se usa el doble del hook.
// MOVO-300: sin suspensión; el caso suspendido tiene sus propios tests.
jest.mock("../src/hooks/use-account-restriction", () => ({
  useActiveSuspension: () => null,
  useAccountRestrictionSync: () => {},
}));

jest.mock("../src/hooks/use-carrier-requirements-sheet", () =>
  require("./mocks/carrier-requirements-sheet-hook"),
);

// El gate de ubicación del transportista tiene su propio test
// (carrier-location-gate.test.tsx): acá se asume que ya cumple los requisitos.
jest.mock("../src/store/carrier-location-gate-store", () => ({
  requireCarrierLocation: (action: () => unknown) => action(),
}));

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

  it("MOVO-117: un 403 CARRIER_LICENSE_NOT_APPROVED abre la checklist con los faltantes, sin error genérico", async () => {
    const { ApiError } = require("@movo/shared/dist/errors/api-error");
    mockCreateTripMutate.mockImplementation((_input, { onError }: any) =>
      onError(
        new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "forbidden", {
          missingRequirements: ["license", "mp_account"],
        }),
      ),
    );

    const { getByTestId, getByText } = await render(<NewTripScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("tf-stub-submit"));
      await Promise.resolve();
    });

    expect(getByText("Para declarar tu viaje necesitás completar estos dos pasos.")).toBeTruthy();
    expect(getByTestId("carrier-requirements-sheet-checklist-license-cta")).toBeTruthy();
    expect(getByTestId("carrier-requirements-sheet-checklist-mp-cta")).toBeTruthy();
    expect(getByTestId("tf-stub-error").props.children).toBeNull();
  });

  it("MOVO-117: un 502 de verificación se muestra como error para reintentar, sin checklist", async () => {
    const { ApiError } = require("@movo/shared/dist/errors/api-error");
    mockCreateTripMutate.mockImplementation((_input, { onError }: any) =>
      onError(new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "down")),
    );

    const { getByTestId, queryByTestId } = await render(<NewTripScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("tf-stub-submit"));
      await Promise.resolve();
    });

    expect(queryByTestId("carrier-requirements-sheet")).toBeNull();
    expect(getByTestId("tf-stub-error").props.children).toBe(
      "No pudimos verificar tus requisitos. Intentá de nuevo en unos minutos.",
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

  it("MOVO-266: pasa el label recurrente y muestra el tope de series inline en la card", async () => {
    const { ApiError } = require("@movo/shared/dist/errors/api-error");
    mockCreateTripMutate.mockImplementation((_input, { onError }: any) =>
      onError(new ApiError(409, "RECURRING_SERIES_LIMIT", "limit")),
    );

    const { getByTestId } = await render(<NewTripScreen />);
    expect(JSON.parse(getByTestId("tf-stub-props").props.children).recurringSubmitLabel).toBe(
      "Declarar viaje recurrente",
    );
    await act(async () => {
      fireEvent.press(getByTestId("tf-stub-submit"));
      await Promise.resolve();
    });

    expect(getByTestId("tf-stub-recurrence-error").props.children).toBe(
      "Ya tenés 3 viajes que se repiten. Dejá de repetir alguno para sumar otro.",
    );
    expect(getByTestId("tf-stub-error").props.children).toBeNull();
  });
});
