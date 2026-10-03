import { fireEvent, render } from "@testing-library/react-native";
import { CarrierTripCta } from "../components/trips/carrier-trip-cta";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

const BASE_TRIP: TripWithAcceptedPackages = {
  id: "trip-test-1",
  carrierId: "carrier-1",
  originAddress: "Av. Colón 1234, Córdoba",
  originLat: -31.4201,
  originLng: -64.1888,
  destinationAddress: "San Martín 450, Villa María",
  destinationLat: -32.4104,
  destinationLng: -63.2404,
  departureAt: "2026-09-10T12:00:00.000Z",
  vehicleType: "Auto",
  status: TripStatus.DECLARED,
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
  hasAcceptedPackages: true,
  acceptedPackagesCount: 1,
};

describe("CarrierTripCta (MOVO-252)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("AC1: renderiza el CTA visible 'Iniciar viaje' para un viaje declared con paquetes aceptados", async () => {
    const onStart = jest.fn();
    const { getByTestId, getByText } = await render(
      <CarrierTripCta trip={BASE_TRIP} onStart={onStart} testID="carrier-cta" />,
    );

    expect(getByTestId("carrier-cta")).toBeTruthy();
    expect(getByText("Iniciar viaje")).toBeTruthy();
    expect(getByTestId("carrier-cta-start-button")).toBeTruthy();

    fireEvent.press(getByTestId("carrier-cta-start-button"));
    expect(onStart).toHaveBeenCalledWith(BASE_TRIP);
  });

  it("AC8: no renderiza el CTA si el viaje declared NO tiene paquetes aceptados", async () => {
    const tripWithoutPackages: TripWithAcceptedPackages = {
      ...BASE_TRIP,
      hasAcceptedPackages: false,
      acceptedPackagesCount: 0,
    };

    const { queryByTestId } = await render(
      <CarrierTripCta trip={tripWithoutPackages} testID="carrier-cta" />,
    );

    expect(queryByTestId("carrier-cta")).toBeNull();
  });

  it("AC8: no renderiza el CTA si el viaje está cancelado o completado", async () => {
    const cancelledTrip: TripWithAcceptedPackages = {
      ...BASE_TRIP,
      status: TripStatus.CANCELLED,
    };
    const completedTrip: TripWithAcceptedPackages = {
      ...BASE_TRIP,
      status: TripStatus.COMPLETED,
    };

    const { queryByTestId: q1 } = await render(
      <CarrierTripCta trip={cancelledTrip} testID="cta-cancelled" />,
    );
    expect(q1("cta-cancelled")).toBeNull();

    const { queryByTestId: q2 } = await render(
      <CarrierTripCta trip={completedTrip} testID="cta-completed" />,
    );
    expect(q2("cta-completed")).toBeNull();
  });

  it("AC2/AC3: cuando el viaje está active, renderiza 'Viaje en curso · ver mapa' y navega a la ruta", async () => {
    const activeTrip: TripWithAcceptedPackages = {
      ...BASE_TRIP,
      status: TripStatus.ACTIVE,
    };

    const { getByTestId, getByText } = await render(
      <CarrierTripCta trip={activeTrip} testID="carrier-cta" />,
    );

    expect(getByText("Viaje en curso · ver mapa")).toBeTruthy();
    expect(getByTestId("carrier-cta-view-map-button")).toBeTruthy();

    fireEvent.press(getByTestId("carrier-cta-view-map-button"));
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/route",
      params: { tripId: activeTrip.id },
    });
  });

  it("AC4/AC5/AC6: muestra el banner de error cuando errorMessage está presente", async () => {
    const { getByTestId, getByText } = await render(
      <CarrierTripCta
        trip={BASE_TRIP}
        errorMessage="Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez."
        testID="carrier-cta"
      />,
    );

    expect(getByTestId("carrier-cta-error")).toBeTruthy();
    expect(
      getByText("Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez."),
    ).toBeTruthy();
  });

  it("muestra indicador de carga y deshabilita el botón mientras isStarting es true", async () => {
    const onStart = jest.fn();
    const { getByTestId, queryByText } = await render(
      <CarrierTripCta
        trip={BASE_TRIP}
        onStart={onStart}
        isStarting={true}
        testID="carrier-cta"
      />,
    );

    expect(queryByText("Iniciar viaje")).toBeNull();
    const btn = getByTestId("carrier-cta-start-button");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it("titula con la ruta (no la fecha) y resume con los paquetes aceptados", async () => {
    const { getByText, queryByText } = await render(
      <CarrierTripCta trip={{ ...BASE_TRIP, acceptedPackagesCount: 3 }} testID="carrier-cta" />,
    );

    expect(getByText("Córdoba → Villa María")).toBeTruthy();
    expect(getByText("3 paquetes")).toBeTruthy();
    expect(queryByText(/paradas/)).toBeNull();
    expect(queryByText(/km/)).toBeNull();
  });
});
