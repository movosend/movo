import { act, fireEvent, render } from "@testing-library/react-native";
import { TripForm } from "../components/trips/trip-form";
import type { AddressSelection } from "../src/types/address-selection";

jest.mock("../src/api/places-client", () => ({
  placesClient: { autocomplete: jest.fn(), details: jest.fn() },
}));

jest.mock("../src/hooks/use-addresses", () => ({
  useAddresses: jest.fn(() => ({ data: [] })),
  useCreateAddress: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("../src/lib/location.ts", () => ({
  getCurrentLocation: jest.fn(),
}));

const ORIGIN: AddressSelection = { address: "Av. Colón 1000, Córdoba", lat: -31.4201, lng: -64.1888, source: "places" };
// ~130km de ORIGIN — muy por encima del umbral de 100m.
const DESTINATION: AddressSelection = { address: "Av. San Martín 100, Villa María", lat: -32.4104, lng: -63.2404, source: "places" };
// ~50m de ORIGIN — por debajo del umbral de 100m.
const TOO_CLOSE: AddressSelection = { address: "Av. Colón 1010, Córdoba", lat: -31.42055, lng: -64.1888, source: "places" };

const FUTURE_DEPARTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST_DEPARTURE = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("TripForm", () => {
  it("no llama a onSubmit si falta origen/destino/vehículo", async () => {
    const onSubmit = jest.fn();
    const { getByTestId } = await render(
      <TripForm testID="tf" submitLabel="Declarar viaje" submitting={false} error={null} onSubmit={onSubmit} />,
    );

    fireEvent.press(getByTestId("tf-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("muestra el error de ubicaciones muy cercanas y no permite enviar", async () => {
    const onSubmit = jest.fn();
    const { getByTestId } = await render(
      <TripForm
        testID="tf"
        submitLabel="Declarar viaje"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        initialValues={{ origin: ORIGIN, destination: TOO_CLOSE, departureAt: FUTURE_DEPARTURE, vehicleType: "Auto" }}
      />,
    );

    expect(getByTestId("tf-too-close-error")).toBeTruthy();
    fireEvent.press(getByTestId("tf-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("muestra el error de fecha pasada y no permite enviar", async () => {
    const onSubmit = jest.fn();
    const { getByTestId } = await render(
      <TripForm
        testID="tf"
        submitLabel="Declarar viaje"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: PAST_DEPARTURE, vehicleType: "Auto" }}
      />,
    );

    expect(getByTestId("tf-past-error")).toBeTruthy();
    fireEvent.press(getByTestId("tf-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("llama a onSubmit con el body armado cuando todo es válido", async () => {
    const onSubmit = jest.fn();
    const { getByTestId } = await render(
      <TripForm
        testID="tf"
        submitLabel="Declarar viaje"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: FUTURE_DEPARTURE, vehicleType: "Auto" }}
      />,
    );

    fireEvent.press(getByTestId("tf-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      originAddress: ORIGIN.address,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      destinationAddress: DESTINATION.address,
      destinationLat: DESTINATION.lat,
      destinationLng: DESTINATION.lng,
      departureAt: FUTURE_DEPARTURE.toISOString(),
      vehicleType: "Auto",
    });
  });

  it("elegir un vehículo desde el picker completa la validez y permite enviar", async () => {
    const onSubmit = jest.fn();
    const { getByTestId } = await render(
      <TripForm
        testID="tf"
        submitLabel="Declarar viaje"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: FUTURE_DEPARTURE, vehicleType: "" as unknown as string }}
      />,
    );

    fireEvent.press(getByTestId("tf-submit"));
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByTestId("tf-vehicle-type"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("tf-vehicle-type-option-Camioneta"));
      await Promise.resolve();
    });
    fireEvent.press(getByTestId("tf-submit"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ vehicleType: "Camioneta" }));
  });

  it("muestra el ErrorBanner cuando se pasa un error de submit", async () => {
    const { getByTestId } = await render(
      <TripForm testID="tf" submitLabel="Declarar viaje" submitting={false} error="No se pudo declarar el viaje." onSubmit={jest.fn()} />,
    );

    expect(getByTestId("tf-error")).toBeTruthy();
  });

  it("muestra el spinner de carga cuando submitting es true", async () => {
    const { getByTestId } = await render(
      <TripForm
        testID="tf"
        submitLabel="Declarar viaje"
        submitting
        error={null}
        onSubmit={jest.fn()}
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: FUTURE_DEPARTURE, vehicleType: "Auto" }}
      />,
    );

    expect(getByTestId("tf-submit").props.accessibilityState?.disabled).toBeTruthy();
  });
});
