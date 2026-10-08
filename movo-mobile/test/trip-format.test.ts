import { ApiError } from "@movo/shared/dist/errors/api-error";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";
import {
  formatDepartureDateOnly,
  formatDepartureLabel,
  formatTripStartErrorMessage,
  formatPackagesCount,
  isTripDepartureToday,
  tripPlaceLabel,
  splitCarrierHomeTrips,
  tripRouteLabel,
  tripStatusLabel,
  tripStatusTone,
} from "../src/lib/trip-format";

describe("trip-format (MOVO-252)", () => {
  it("tripStatusLabel devuelve las etiquetas esperadas", () => {
    expect(tripStatusLabel(TripStatus.DECLARED)).toBe("Declarado");
    expect(tripStatusLabel(TripStatus.ACTIVE)).toBe("Activo");
    expect(tripStatusLabel(TripStatus.COMPLETED)).toBe("Completado");
    expect(tripStatusLabel(TripStatus.CANCELLED)).toBe("Cancelado");
  });

  it("tripStatusTone asigna lima a activo y neutral a declarado", () => {
    expect(tripStatusTone(TripStatus.ACTIVE)).toBe("lime");
    expect(tripStatusTone(TripStatus.DECLARED)).toBe("neutral");
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
