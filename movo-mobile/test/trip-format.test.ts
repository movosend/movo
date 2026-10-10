import { ApiError } from "@movo/shared/dist/errors/api-error";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";
import {
  formatDepartureDateOnly,
  formatTripStartDate,
  formatTripStartErrorMessage,
  formatPackagesCount,
  isTripDepartureToday,
  tripStartBlocker,
  tripStartBlockerMessage,
  tripPlaceLabel,
  splitCarrierHomeTrips,
  tripRouteLabel,
  tripStatusLabel,
  tripStubParts,
  tripHistoryDate,
  tripHistorySubtext,
  tripCarriedChipLabel,
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

  it("isTripDepartureToday usa el día calendario argentino, no el UTC (MOVO-277)", () => {
    // Salida 2026-10-08 23:30 AR = 2026-10-09T02:30Z; ahora 2026-10-08 20:00 AR.
    expect(isTripDepartureToday("2026-10-09T02:30:00.000Z", new Date("2026-10-08T23:00:00.000Z"))).toBe(true);
  });

  describe("tripStartBlocker (MOVO-277)", () => {
    const NOW = new Date("2026-10-08T15:00:00.000Z"); // 12:00 AR

    it("antes del día de salida bloquea por fecha, aunque haya paquetes ejecutables", () => {
      expect(tripStartBlocker({ departureAt: "2026-10-10T13:00:00.000Z", executablePackagesCount: 2 }, NOW)).toBe(
        "too_early",
      );
    });

    it("el día de salida, a cualquier hora, sin paquetes ejecutables bloquea por el pago", () => {
      expect(tripStartBlocker({ departureAt: "2026-10-08T23:00:00.000Z", executablePackagesCount: 0 }, NOW)).toBe(
        "packages_not_ready",
      );
    });

    it("el día de salida o después, con paquetes ejecutables, no bloquea", () => {
      expect(tripStartBlocker({ departureAt: "2026-10-08T23:00:00.000Z", executablePackagesCount: 1 }, NOW)).toBeNull();
      expect(tripStartBlocker({ departureAt: "2026-10-01T13:00:00.000Z", executablePackagesCount: 1 }, NOW)).toBeNull();
    });

    it("el mensaje de fecha nombra el día de salida en calendario argentino", () => {
      // 2026-10-10T02:00Z es el viernes 9 de octubre a las 23:00 en Argentina.
      // Se fija el texto completo para detectar diferencias de ICU entre plataformas (Hermes vs
      // Node); solo se tolera la coma tras el día de la semana, que varía según la versión.
      expect(formatTripStartDate("2026-10-10T02:00:00.000Z").replace(",", "")).toBe("viernes 9 de octubre");
      expect(
        tripStartBlockerMessage({ departureAt: "2026-10-10T02:00:00.000Z" }, "too_early").replace(",", ""),
      ).toBe("Podés iniciarlo el viernes 9 de octubre.");
      expect(tripStartBlockerMessage({ departureAt: "2026-10-10T02:00:00.000Z" }, "packages_not_ready")).toBe(
        "Tus paquetes todavía esperan la confirmación del pago.",
      );
    });
  });

  it("MOVO-262: talón, fecha y subtextos del historial siguen el mockup", () => {
    const stub = tripStubParts("2026-10-02T11:00:00.000Z");
    expect(stub.day).toBe("2");
    expect(stub.mon).toBe("OCT");
    expect(stub.time).toMatch(/^\d{2}:\d{2}$/);
    expect(tripHistoryDate("2026-09-26T15:00:00.000Z")).toBe("sáb 26 sep");
    expect(tripMonthLabel("2026-09-26T15:00:00.000Z")).toBe("Septiembre 2026");
    expect(tripHistorySubtext({ status: TripStatus.COMPLETED, acceptedPackagesCount: 1, cancelledAt: null })).toBeNull();
    expect(tripCarriedChipLabel(1)).toBe("Llevaste 1 paquete");
    expect(tripCarriedChipLabel(3)).toBe("Llevaste 3 paquetes");
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

    it("MOVO-277: TRIP_START_TOO_EARLY dice desde qué día se puede iniciar", () => {
      const err = new ApiError(409, "TRIP_START_TOO_EARLY", "Muy temprano");
      expect(formatTripStartErrorMessage(err, "2026-10-10T02:00:00.000Z")).toMatch(
        /^Podés iniciar este viaje el viernes,? 9 de octubre\.$/,
      );
      expect(formatTripStartErrorMessage(err)).toBe(
        "Todavía no podés iniciar este viaje: se habilita el día de salida.",
      );
    });

    it("MOVO-277: TRIP_PACKAGES_NOT_READY explica que los paquetes esperan el pago", () => {
      const err = new ApiError(409, "TRIP_PACKAGES_NOT_READY", "No listos");
      expect(formatTripStartErrorMessage(err)).toBe(
        "Tus paquetes todavía esperan la confirmación del pago. Vas a poder iniciar el viaje cuando estén listos para retirar.",
      );
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

describe("trip-format — Inicio (jerarquía de viajes)", () => {
  it("tripPlaceLabel se queda con la localidad, sin código postal ni provincia", () => {
    expect(tripPlaceLabel("San Martín 450, X5152 Villa Carlos Paz, Córdoba, Argentina")).toBe(
      "Villa Carlos Paz",
    );
    expect(tripPlaceLabel("Av. Colón 100, Córdoba")).toBe("Córdoba");
    expect(tripPlaceLabel("Av. Colón 100")).toBe("Av. Colón 100");
  });

  it("tripRouteLabel arma origen → destino", () => {
    expect(
      tripRouteLabel({ originAddress: "Av. Colón 100, Córdoba", destinationAddress: "Bv. Oroño 50, Rosario" }),
    ).toBe("Córdoba → Rosario");
  });

  it("formatPackagesCount usa singular y plural", () => {
    expect(formatPackagesCount(1)).toBe("1 paquete");
    expect(formatPackagesCount(3)).toBe("3 paquetes");
  });

  describe("splitCarrierHomeTrips", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const trip = (id: string, offsetDays: number, overrides: Partial<TripWithAcceptedPackages> = {}) =>
      ({
        id,
        departureAt: new Date(Date.now() + offsetDays * DAY_MS).toISOString(),
        status: TripStatus.DECLARED,
        hasAcceptedPackages: true,
        ...overrides,
      }) as TripWithAcceptedPackages;

    it("el viaje en curso gana la card; los declared con paquetes van al resto", () => {
      const { primaryTrip, otherTrips } = splitCarrierHomeTrips([
        trip("today", 0),
        trip("active", -1, { status: TripStatus.ACTIVE }),
        trip("past", -7),
      ]);
      expect(primaryTrip?.id).toBe("active");
      expect(otherTrips.map((t) => t.id)).toEqual(["past", "today"]);
    });

    it("sin viaje en curso, la card es el de hoy; un declared pasado no se trata distinto", () => {
      const { primaryTrip, otherTrips } = splitCarrierHomeTrips([trip("future", 3), trip("past", -7), trip("today", 0)]);
      expect(primaryTrip?.id).toBe("today");
      expect(otherTrips.map((t) => t.id)).toEqual(["past", "future"]);
    });

    it("sin viaje de hoy no hay card; deja afuera declared sin paquetes y cancelados", () => {
      const { primaryTrip, otherTrips } = splitCarrierHomeTrips([
        trip("future", 3),
        trip("empty", 1, { hasAcceptedPackages: false }),
        trip("cancelled", 2, { status: TripStatus.CANCELLED }),
      ]);
      expect(primaryTrip).toBeNull();
      expect(otherTrips.map((t) => t.id)).toEqual(["future"]);
    });
  });
});
