import { renderHook } from "@testing-library/react-native";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";
import { useResumeActiveTrip } from "../src/hooks/use-resume-active-trip";
import { useBootStore } from "../src/store/boot-store";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

function trip(overrides: Partial<TripWithAcceptedPackages>): TripWithAcceptedPackages {
  return {
    id: "trip-1",
    status: TripStatus.ACTIVE,
    hasAcceptedPackages: true,
    acceptedPackagesCount: 1,
    executablePackagesCount: 1,
    ...overrides,
  } as TripWithAcceptedPackages;
}

type Input = Parameters<typeof useResumeActiveTrip>[0];
const base: Input = { userId: "u1", isCarrier: true, isFocused: true, trips: undefined };

describe("useResumeActiveTrip (feedback de TestFlight: volver al viaje en curso al abrir la app)", () => {
  beforeEach(() => {
    mockPush.mockClear();
    useBootStore.setState({ activeTripResumeCheckedFor: null });
  });

  it("con un viaje en curso, lleva a su pantalla cuando llega la lista", async () => {
    const { rerender } = await renderHook((props: Input) => useResumeActiveTrip(props), { initialProps: base });
    expect(mockPush).not.toHaveBeenCalled();

    await rerender({ ...base, trips: [trip({ id: "declarado", status: TripStatus.DECLARED }), trip({ id: "en-curso" })] });
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/route", params: { tripId: "en-curso" } });
  });

  it("decide una sola vez por usuario: volver a Inicio desde el viaje no lo reabre", async () => {
    const trips = [trip({})];
    const first = await renderHook(() => useResumeActiveTrip({ ...base, trips }));
    await first.unmount();
    const second = await renderHook(() => useResumeActiveTrip({ ...base, trips }));
    await second.unmount();
    expect(mockPush).toHaveBeenCalledTimes(1);

    // Otro usuario en la misma sesión de la app sí se evalúa.
    await renderHook(() => useResumeActiveTrip({ ...base, userId: "u2", trips }));
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it("no navega sin viaje en curso, con un activo sin paquetes, ni si no es transportista", async () => {
    await renderHook(() => useResumeActiveTrip({ ...base, trips: [trip({ status: TripStatus.DECLARED })] }));
    await renderHook(() => useResumeActiveTrip({ ...base, userId: "u2", trips: [trip({ hasAcceptedPackages: false })] }));
    await renderHook(() => useResumeActiveTrip({ ...base, userId: "u3", isCarrier: false, trips: [trip({})] }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("en el arranque, si Inicio todavía no tiene foco cuando ya están los viajes, espera al foco y navega", async () => {
    const trips = [trip({})];
    const { rerender } = await renderHook((props: Input) => useResumeActiveTrip(props), {
      initialProps: { ...base, isFocused: false, trips },
    });
    expect(mockPush).not.toHaveBeenCalled();
    await rerender({ ...base, isFocused: true, trips });
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/route", params: { tripId: "trip-1" } });
  });

  it("si Inicio tuvo foco y lo perdió antes de llegar los viajes (una notificación navegó), no la pisa al volver", async () => {
    const { rerender } = await renderHook((props: Input) => useResumeActiveTrip(props), { initialProps: base });
    await rerender({ ...base, isFocused: false });
    await rerender({ ...base, isFocused: false, trips: [trip({})] });
    await rerender({ ...base, isFocused: true, trips: [trip({})] });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
