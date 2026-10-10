import { act, render } from "@testing-library/react-native";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spy } = require("./mocks/react-native-maps-spy") as { spy: { fit: jest.Mock; tracks: Array<boolean | undefined> } };
import { TripDetailMap } from "../components/trips/trip-detail-map";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";

jest.mock("react-native-maps", () => require("./mocks/react-native-maps-spy"));

jest.mock("../src/hooks/use-shipments", () => ({
  useShipmentRoute: () => ({ data: undefined, isError: true }),
}));

const BASE: TripWithAcceptedPackages = {
  id: "trip-1",
  carrierId: "c-1",
  originAddress: "Córdoba",
  originLat: -31.4,
  originLng: -64.18,
  destinationAddress: "Villa María",
  destinationLat: -32.4,
  destinationLng: -63.24,
  departureAt: "2026-10-12T12:00:00.000Z",
  vehicleType: "Fiat Cronos",
  status: TripStatus.DECLARED,
  cancelledAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  hasAcceptedPackages: false,
  acceptedPackagesCount: 0,
  executablePackagesCount: 0,
  packages: [],
} as unknown as TripWithAcceptedPackages;

const PKG = {
  shipmentId: "ship-1",
  pickupLat: -31.5,
  pickupLng: -64.1,
  deliveryLat: -32.1,
  deliveryLng: -63.5,
} as unknown as NonNullable<TripWithAcceptedPackages["packages"]>[number];

describe("TripDetailMap (review PR #225)", () => {
  beforeEach(() => {
    spy.fit.mockClear();
    spy.tracks.length = 0;
  });

  it("los marcadores de origen y destino también dejan de trackear cambios de vista", async () => {
    jest.useFakeTimers();
    try {
      const { rerender } = await render(<TripDetailMap trip={BASE} />);
      expect(spy.tracks.slice(0, 2)).toEqual([true, true]);

      await act(async () => {
        jest.advanceTimersByTime(700);
      });
      spy.tracks.length = 0;
      await rerender(<TripDetailMap trip={BASE} />);
      expect(spy.tracks).toEqual([false, false]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("se re-encuadra cuando un refetch trae paquetes nuevos, y no si los puntos no cambian", async () => {
    const { rerender } = await render(<TripDetailMap trip={BASE} />);
    expect(spy.fit).toHaveBeenCalledTimes(1); // onMapReady

    await rerender(<TripDetailMap trip={{ ...BASE }} />); // mismo contenido, objeto nuevo
    expect(spy.fit).toHaveBeenCalledTimes(1);

    await rerender(<TripDetailMap trip={{ ...BASE, packages: [PKG] }} />);
    expect(spy.fit).toHaveBeenCalledTimes(2);
    expect(spy.fit.mock.calls[1][0]).toHaveLength(4);
  });
});
