import { ApiError } from "@movo/shared/dist/errors/api-error";
import { TripStatus } from "../src/api/trips-client";
import {
  formatDepartureDateOnly,
  formatDepartureLabel,
  formatTripStartErrorMessage,
  isTripDepartureToday,
  tripStatusLabel,
  tripStatusTone,
  tripStubParts,
  tripHistoryDate,
  tripHistorySubtext,
  tripDeliveredChipLabel,
  tripMonthLabel,
} from "../src/lib/trip-format";

describe("trip-format (MOVO-252)", () => {
  it("tripStatusLabel devuelve las etiquetas esperadas", () => {
    expect(tripStatusLabel(TripStatus.DECLARED)).toBe("Declarado");
    expect(tripStatusLabel(TripStatus.ACTIVE)).toBe("En curso");
    expect(tripStatusLabel(TripStatus.EXPIRED)).toBe("Venció");
    expect(tripStatusLabel(TripStatus.COMPLETED)).toBe("Completado");
    expect(tripStatusLabel(TripStatus.CANCELLED)).toBe("Cancelado");
  });

  it("tripStatusTone (MOVO-262 AC2): lima a declarado, oscuro a en curso, neutral a vencido", () => {
    expect(tripStatusTone(TripStatus.ACTIVE)).toBe("dark");
    expect(tripStatusTone(TripStatus.DECLARED)).toBe("lime");
    expect(tripStatusTone(TripStatus.EXPIRED)).toBe("neutral");
    expect(tripStatusTone(TripStatus.COMPLETED)).toBe("success");
    expect(tripStatusTone(TripStatus.CANCELLED)).toBe("danger");
  });

  it("formatDepartureDateOnly formatea día y mes en español", () => {
    const formatted = formatDepartureDateOnly("2026-09-10T12:00:00.000Z");
    expect(formatted).toMatch(/10 de septiembre/);
  });

  it("isTripDepartureToday detecta correctamente si la fecha es hoy", () => {
    const nowIso = new Date().toISOString();
    expect(isTripDepartureToday(nowIso)).toBe(true);

    const pastIso = "2020-01-01T12:00:00.000Z";
    expect(isTripDepartureToday(pastIso)).toBe(false);
  });

  it("MOVO-262: talón, fecha y subtextos del historial siguen el mockup", () => {
    const stub = tripStubParts("2026-10-02T11:00:00.000Z");
    expect(stub.day).toBe("2");
    expect(stub.mon).toBe("OCT");
    expect(stub.time).toMatch(/^\d{2}:\d{2}$/);
    expect(tripHistoryDate("2026-09-26T15:00:00.000Z")).toBe("sáb 26 sep");
    expect(tripMonthLabel("2026-09-26T15:00:00.000Z")).toBe("Septiembre 2026");
    expect(tripHistorySubtext({ status: TripStatus.COMPLETED, acceptedPackagesCount: 1, cancelledAt: null })).toBeNull();
    expect(tripDeliveredChipLabel(1)).toBe("1 paquete entregado");
    expect(tripDeliveredChipLabel(3)).toBe("3 paquetes entregados");
    expect(tripHistorySubtext({ status: TripStatus.EXPIRED, acceptedPackagesCount: 0, cancelledAt: null })).toBe("Sin paquetes aceptados");
    expect(tripHistorySubtext({ status: TripStatus.CANCELLED, acceptedPackagesCount: 0, cancelledAt: "2026-09-12T15:00:00.000Z" })).toBe("Lo cancelaste el 12 sep");
    expect(tripHistorySubtext({ status: TripStatus.ACTIVE, acceptedPackagesCount: 0, cancelledAt: null })).toBeNull();
  });

  describe("formatTripStartErrorMessage", () => {

    it("AC6: formatea explícitamente el límite de 1 viaje activo por cuenta (TRIP_ALREADY_HAS_ACTIVE_TRIP)", () => {
      const err = new ApiError(409, "TRIP_ALREADY_HAS_ACTIVE_TRIP", "Conflicto activo");
      const msg = formatTripStartErrorMessage(err);
      expect(msg).toBe("Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez.");
    });

    it("TRIP_NOT_DECLARED indica que el viaje ya fue iniciado o finalizado", () => {
      const err = new ApiError(409, "TRIP_NOT_DECLARED", "No declarado");
      const msg = formatTripStartErrorMessage(err);
      expect(msg).toBe("El viaje ya fue iniciado o finalizado.");
    });

    it("AC4: error genérico de red o backend devuelve mensaje amigable", () => {
      const netErr = new ApiError(0, "INTERNAL_ERROR", "No se pudo conectar con el servidor");
      const msgNet = formatTripStartErrorMessage(netErr);
      expect(msgNet).toBe("No se pudo conectar con el servidor");

      const unknownErr = new Error("Desconocido");
      const msgUnknown = formatTripStartErrorMessage(unknownErr);
      expect(msgUnknown).toBe("No pudimos iniciar el viaje. Intentá de nuevo.");
    });
  });
});
