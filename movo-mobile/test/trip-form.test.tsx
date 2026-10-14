import { argentinaWeekday } from "@movo/shared/dist/config/trip-recurrence";
import { fireEvent, render } from "@testing-library/react-native";
import { TripForm } from "../components/trips/trip-form";
import { useMyVehicle } from "../src/hooks/use-vehicle";
import type { AddressSelection } from "../src/types/address-selection";
import { sortWeekdays, toUntilDateString } from "../src/lib/trip-recurrence";

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

jest.mock("../src/hooks/use-vehicle", () => ({
  useMyVehicle: jest.fn(),
}));

const mockUseMyVehicle = useMyVehicle as jest.Mock;

const REGISTERED_VEHICLE = {
  brand: "Nissan",
  model: "March",
  cargoCapacityLabel: "Hasta 15 kg · 60 L",
  licensePlate: "AB902ED",
};

const ORIGIN: AddressSelection = { address: "Av. Colón 1000, Córdoba", lat: -31.4201, lng: -64.1888, source: "places" };
// ~130km de ORIGIN — muy por encima del umbral de 100m.
const DESTINATION: AddressSelection = { address: "Av. San Martín 100, Villa María", lat: -32.4104, lng: -63.2404, source: "places" };
// ~50m de ORIGIN — por debajo del umbral de 100m.
const TOO_CLOSE: AddressSelection = { address: "Av. Colón 1010, Córdoba", lat: -31.42055, lng: -64.1888, source: "places" };

const FUTURE_DEPARTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST_DEPARTURE = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("TripForm", () => {
  beforeEach(() => {
    mockUseMyVehicle.mockReturnValue({ data: REGISTERED_VEHICLE });
  });

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
        initialValues={{ origin: ORIGIN, destination: TOO_CLOSE, departureAt: FUTURE_DEPARTURE }}
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
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: PAST_DEPARTURE }}
      />,
    );

    expect(getByTestId("tf-past-error")).toBeTruthy();
    fireEvent.press(getByTestId("tf-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("llama a onSubmit con el body armado cuando todo es válido, tomando el vehículo de la ficha", async () => {
    const onSubmit = jest.fn();
    const { getByTestId } = await render(
      <TripForm
        testID="tf"
        submitLabel="Declarar viaje"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: FUTURE_DEPARTURE }}
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
      vehicleType: "Nissan March",
    });
  });

  it("sin ficha de vehículo registrada, muestra el cartel de registro y no permite enviar", async () => {
    mockUseMyVehicle.mockReturnValue({ data: null });
    const onSubmit = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <TripForm
        testID="tf"
        submitLabel="Declarar viaje"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: FUTURE_DEPARTURE }}
      />,
    );

    expect(getByTestId("tf-register-vehicle")).toBeTruthy();
    fireEvent.press(getByTestId("tf-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(queryByTestId("tf-vehicle-type")).toBeNull();
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
        initialValues={{ origin: ORIGIN, destination: DESTINATION, departureAt: FUTURE_DEPARTURE }}
      />,
    );

    expect(getByTestId("tf-submit").props.accessibilityState?.disabled).toBeTruthy();
  });

  describe("MOVO-266: Se repite", () => {
    const FIXED = argentinaWeekday(FUTURE_DEPARTURE);
    const OTHERS = [6, 0, 1, 2].filter((day) => day !== FIXED).slice(0, 2);
    const BASE_BODY = {
      originAddress: ORIGIN.address,
      originLat: ORIGIN.lat,
      originLng: ORIGIN.lng,
      destinationAddress: DESTINATION.address,
      destinationLat: DESTINATION.lat,
      destinationLng: DESTINATION.lng,
      departureAt: FUTURE_DEPARTURE.toISOString(),
      vehicleType: "Nissan March",
    };
    const VALUES = { origin: ORIGIN, destination: DESTINATION, departureAt: FUTURE_DEPARTURE };

    const renderCreate = (onSubmit = jest.fn(), extra: object = {}) =>
      render(
        <TripForm
          testID="tf"
          submitLabel="Declarar viaje"
          recurringSubmitLabel="Declarar viaje recurrente"
          submitting={false}
          error={null}
          onSubmit={onSubmit}
          initialValues={VALUES}
          {...extra}
        />,
      );

    it("el switch muestra el bloque, mueve fecha/hora adentro y cambia el botón; apagarlo los devuelve", async () => {
      const { getByTestId, queryByTestId, getByText } = await renderCreate();

      expect(getByTestId("tf-departure")).toBeTruthy();
      expect(queryByTestId(`tf-recurrence-day-${FIXED}`)).toBeNull();

      await fireEvent.press(getByTestId("tf-recurrence-toggle"));
      expect(queryByTestId("tf-departure")).toBeNull();
      expect(getByTestId("tf-recurrence-time")).toBeTruthy();
      expect(getByTestId("tf-recurrence-from")).toBeTruthy();
      expect(getByTestId("tf-recurrence-preview")).toBeTruthy();
      expect(getByText("Declarar viaje recurrente")).toBeTruthy();

      await fireEvent.press(getByTestId("tf-recurrence-toggle"));
      expect(getByTestId("tf-departure")).toBeTruthy();
      expect(getByText("Declarar viaje")).toBeTruthy();
    });

    it("el chip del día de la salida queda fijo y el payload usa 0 = domingo, no la posición", async () => {
      const onSubmit = jest.fn();
      const { getByTestId } = await renderCreate(onSubmit);

      await fireEvent.press(getByTestId("tf-recurrence-toggle"));
      const fixedChip = getByTestId(`tf-recurrence-day-${FIXED}`);
      expect(fixedChip.props.accessibilityState).toEqual(expect.objectContaining({ checked: true, disabled: true }));
      await fireEvent.press(fixedChip);
      for (const day of OTHERS) await fireEvent.press(getByTestId(`tf-recurrence-day-${day}`));
      await fireEvent.press(getByTestId("tf-submit"));

      expect(onSubmit).toHaveBeenCalledWith({ ...BASE_BODY, recurrenceWeekdays: sortWeekdays([FIXED, ...OTHERS]) });
    });

    it("'Hasta una fecha' manda recurrenceUntil como YYYY-MM-DD", async () => {
      const onSubmit = jest.fn();
      const { getByTestId } = await renderCreate(onSubmit);

      await fireEvent.press(getByTestId("tf-recurrence-toggle"));
      await fireEvent.press(getByTestId("tf-recurrence-until-date"));
      await fireEvent.press(getByTestId("tf-submit"));

      const until = new Date(FUTURE_DEPARTURE.getTime() + 28 * 24 * 60 * 60 * 1000);
      expect(onSubmit).toHaveBeenCalledWith({
        ...BASE_BODY,
        recurrenceWeekdays: [FIXED],
        recurrenceUntil: toUntilDateString(until),
      });
    });

    it("con el switch apagado el alta no manda campos de recurrencia", async () => {
      const onSubmit = jest.fn();
      const { getByTestId } = await renderCreate(onSubmit);

      await fireEvent.press(getByTestId("tf-submit"));

      expect(onSubmit).toHaveBeenCalledWith(BASE_BODY);
    });

    it("muestra inline el error del tope de series", async () => {
      const { getByTestId } = await renderCreate(jest.fn(), {
        recurrenceError: "Ya tenés 3 viajes que se repiten. Dejá de repetir alguno para sumar otro.",
      });

      expect(getByTestId("tf-recurrence-error")).toBeTruthy();
    });

    describe("edición", () => {
      const renderEdit = (onSubmit: jest.Mock, extra: object = {}) =>
        render(
          <TripForm
            testID="tf"
            variant="edit"
            submitLabel="Guardar cambios"
            submitting={false}
            error={null}
            onSubmit={onSubmit}
            initialValues={{ ...VALUES, recurrence: { weekdays: [FIXED], until: null } }}
            {...extra}
          />,
        );

      it("sin tocar la recurrencia no la manda, y avisa que aplica a los próximos", async () => {
        const onSubmit = jest.fn();
        const { getByTestId } = await renderEdit(onSubmit);

        expect(getByTestId("tf-series-note")).toBeTruthy();
        await fireEvent.press(getByTestId("tf-submit"));

        expect(onSubmit).toHaveBeenCalledWith(BASE_BODY);
      });

      it("apagar el switch manda recurrenceWeekdays: null", async () => {
        const onSubmit = jest.fn();
        const { getByTestId } = await renderEdit(onSubmit);

        await fireEvent.press(getByTestId("tf-recurrence-toggle"));
        await fireEvent.press(getByTestId("tf-submit"));

        expect(onSubmit).toHaveBeenCalledWith({ ...BASE_BODY, recurrenceWeekdays: null });
      });

      it("con paquetes aceptados solo deja editar los días y manda solo la recurrencia", async () => {
        const onSubmit = jest.fn();
        const { getByTestId, queryByTestId } = await renderEdit(onSubmit, { mode: "recurrence-only" });

        expect(getByTestId("tf-locked-notice")).toBeTruthy();
        expect(queryByTestId("tf-origin")).toBeNull();
        expect(getByTestId("tf-recurrence-time-time").props.accessibilityState?.disabled).toBe(true);
        // Sin cambios no hay nada que guardar.
        expect(getByTestId("tf-submit").props.accessibilityState?.disabled).toBeTruthy();

        await fireEvent.press(getByTestId(`tf-recurrence-day-${OTHERS[0]}`));
        await fireEvent.press(getByTestId("tf-submit"));

        expect(onSubmit).toHaveBeenCalledWith({ recurrenceWeekdays: sortWeekdays([FIXED, OTHERS[0]]) });
      });

      it("en un viaje que no es el vigente de la serie la recurrencia es de solo lectura y no viaja", async () => {
        const onSubmit = jest.fn();
        const { getByTestId } = await renderEdit(onSubmit, {
          recurrenceReadOnlyReason: "Este viaje ya tiene el siguiente declarado.",
        });

        expect(getByTestId("tf-recurrence-read-only")).toBeTruthy();
        expect(getByTestId("tf-recurrence-toggle").props.accessibilityState?.disabled).toBe(true);
        await fireEvent.press(getByTestId("tf-submit"));

        expect(onSubmit).toHaveBeenCalledWith(BASE_BODY);
      });
    });
  });
});
