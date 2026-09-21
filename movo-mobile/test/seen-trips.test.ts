const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
}));

import { diffAndMarkSeenTrips, markTripAsSeen } from "../src/lib/seen-trips";

describe("seen-trips (MOVO-236, AC2)", () => {
  beforeEach(() => mockStore.clear());

  it("la primera vez (nada persistido todavía) siembra el set sin reportar ningún trip nuevo", async () => {
    const { newTripIds } = await diffAndMarkSeenTrips(["trip-1", "trip-2"]);

    expect(newTripIds).toEqual([]);
  });

  it("una segunda carga con los mismos ids no reporta nada nuevo", async () => {
    await diffAndMarkSeenTrips(["trip-1", "trip-2"]);

    const { newTripIds } = await diffAndMarkSeenTrips(["trip-1", "trip-2"]);

    expect(newTripIds).toEqual([]);
  });

  it("un id que aparece después de la siembra inicial se reporta como nuevo", async () => {
    await diffAndMarkSeenTrips(["trip-1"]);

    const { newTripIds } = await diffAndMarkSeenTrips(["trip-1", "trip-2"]);

    expect(newTripIds).toEqual(["trip-2"]);
  });

  it("un trip nuevo reportado una vez no se vuelve a reportar en la carga siguiente", async () => {
    await diffAndMarkSeenTrips(["trip-1"]);
    await diffAndMarkSeenTrips(["trip-1", "trip-2"]);

    const { newTripIds } = await diffAndMarkSeenTrips(["trip-1", "trip-2"]);

    expect(newTripIds).toEqual([]);
  });

  it("markTripAsSeen evita que ese id se reporte como nuevo aunque nunca se haya visto en una lista", async () => {
    await markTripAsSeen("trip-manual");

    const { newTripIds } = await diffAndMarkSeenTrips(["trip-manual", "trip-auto"]);

    expect(newTripIds).toEqual(["trip-auto"]);
  });

  it("markTripAsSeen es idempotente (llamarlo dos veces con el mismo id no duplica el set)", async () => {
    await markTripAsSeen("trip-1");
    await markTripAsSeen("trip-1");

    const { newTripIds } = await diffAndMarkSeenTrips(["trip-1"]);

    expect(newTripIds).toEqual([]);
  });

  it("un trip que desaparece de la lista (ej. cancelado) no rompe el diff de una carga posterior", async () => {
    await diffAndMarkSeenTrips(["trip-1", "trip-2"]);

    const { newTripIds } = await diffAndMarkSeenTrips(["trip-2", "trip-3"]);

    expect(newTripIds).toEqual(["trip-3"]);
  });
});
