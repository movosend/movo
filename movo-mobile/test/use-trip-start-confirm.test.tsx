import { act, renderHook } from "@testing-library/react-native";
import type { TripWithAcceptedPackages } from "../src/api/trips-client";
import { useTripStartConfirm } from "../src/hooks/use-trip-start-confirm";
import { tripStartWhenLabel } from "../components/trips/trip-start-sheet";

const TRIP = { id: "t1" } as TripWithAcceptedPackages;

describe("useTripStartConfirm", () => {
  it("un segundo toque mientras la hoja está abierta no reemplaza la confirmación pendiente", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result } = await renderHook(() => useTripStartConfirm());

    await act(async () => result.current.requestStart(TRIP, first));
    await act(async () => result.current.requestStart(TRIP, second));
    await act(async () => result.current.sheetProps.onConfirm());
    await act(async () => result.current.sheetProps.onClosed?.());

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("si se desmonta con la confirmación pendiente (antes de onClosed), el viaje igual se inicia", async () => {
    const onConfirm = jest.fn();
    const { result, unmount } = await renderHook(() => useTripStartConfirm());

    await act(async () => result.current.requestStart(TRIP, onConfirm));
    await act(async () => result.current.sheetProps.onConfirm());
    await act(async () => unmount());

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancelar no inicia, ni al cerrar ni al desmontar, y deja volver a pedirlo", async () => {
    const onConfirm = jest.fn();
    const { result, unmount } = await renderHook(() => useTripStartConfirm());

    await act(async () => result.current.requestStart(TRIP, onConfirm));
    await act(async () => result.current.sheetProps.onClose());
    await act(async () => result.current.sheetProps.onClosed?.());
    expect(result.current.sheetProps.visible).toBe(false);

    await act(async () => result.current.requestStart(TRIP, onConfirm));
    expect(result.current.sheetProps.visible).toBe(true);
    await act(async () => result.current.sheetProps.onClose());
    await act(async () => unmount());

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("tripStartWhenLabel", () => {
  it("si el viaje sale hoy, dice Hoy y la hora", () => {
    expect(tripStartWhenLabel(new Date().toISOString())).toMatch(/^Hoy · \d{2}:\d{2} h$/);
  });

  it("si no sale hoy, dice la fecha: se puede iniciar días antes o vencido", () => {
    const label = tripStartWhenLabel("2026-11-21T20:00:00.000Z");
    expect(label).not.toMatch(/^Hoy/);
    expect(label).toMatch(/21/);
    expect(label).toMatch(/noviembre/i);
  });
});
