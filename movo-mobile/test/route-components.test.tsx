import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { StopList } from "../components/route/stop-list";
import { RouteMap } from "../components/route/route-map";
import type { CarrierRoute } from "@movo/shared/dist/types/routing";

describe("Componentes de Ruta (MOVO-207)", () => {
  const sampleRoute: CarrierRoute = {
    stops: [
      {
        stopOrder: 1,
        shipmentId: "ship-101",
        type: "pickup",
        lat: -31.425,
        lng: -64.187,
        address: "Av. Colón 1200",
        timeWindowStart: "2026-09-15T09:00:00.000Z",
        timeWindowEnd: "2026-09-15T11:00:00.000Z",
        estimatedArrivalMinutes: 5,
        estimatedArrivalAt: "2026-09-15T09:05:00.000Z",
        outsideTimeWindow: false,
      },
      {
        stopOrder: 2,
        shipmentId: "ship-101",
        type: "delivery",
        lat: -31.9139,
        lng: -63.6817,
        address: "San Martín 450",
        timeWindowStart: "2026-09-15T10:00:00.000Z",
        timeWindowEnd: "2026-09-15T11:00:00.000Z",
        estimatedArrivalMinutes: 80,
        estimatedArrivalAt: "2026-09-15T11:20:00.000Z",
        outsideTimeWindow: true, // Llega 11:20 cuando la ventana cierra a las 11:00
      },
      {
        stopOrder: 3,
        shipmentId: "ship-102",
        type: "delivery",
        lat: -32.0416,
        lng: -63.5698,
        address: "Belgrano 80",
        estimatedArrivalMinutes: 110,
        outsideTimeWindow: false,
      },
    ],
    totalDistanceKm: 42.8,
    totalDurationMinutes: 110,
    optimized: true,
    disclaimer: null,
  };

  describe("StopList", () => {
    it("AC4: renderiza próxima parada activa en modo compacto y todas al expandir (AC11)", async () => {
      const { getByText, getByTestId, getAllByText } = await render(
        <StopList route={sampleRoute} />
      );

      // Cabecera inicial en modo compacto
      expect(getByText(/Próxima parada/)).toBeTruthy();
      expect(getByText(/42.8 km/)).toBeTruthy();

      // Parada 1 visible en modo compacto
      expect(getByTestId("stop-row-1")).toBeTruthy();
      expect(getByText("Av. Colón 1200")).toBeTruthy();
      expect(getByText(/retiro/i)).toBeTruthy();

      // Expandir el itinerario completo
      await fireEvent.press(getByTestId("stop-list-toggle-sheet"));

      // Ahora se visualizan todas las paradas
      expect(getByText(/Itinerario · 3 paradas/)).toBeTruthy();
      expect(getByTestId("stop-row-2")).toBeTruthy();
      expect(getByText("San Martín 450")).toBeTruthy();
      expect(getByTestId("stop-row-3")).toBeTruthy();

      // AC11: Formato de ETA aprox.
      expect(getByTestId("stop-eta-1").props.children).toMatch(/aprox/);
      expect(getByTestId("stop-eta-3").props.children).toMatch(/\+110 min aprox/);
    });

    it("AC5: muestra explícitamente el badge de demora/fuera de ventana si outsideTimeWindow es true al expandir", async () => {
      const { getByTestId, queryByTestId } = await render(
        <StopList route={sampleRoute} />
      );

      // Expandir lista
      await fireEvent.press(getByTestId("stop-list-toggle-sheet"));

      // Parada 1 no tiene retraso
      expect(queryByTestId("stop-late-badge-1")).toBeNull();

      // Parada 2 tiene outsideTimeWindow = true
      expect(getByTestId("stop-late-badge-2")).toBeTruthy();
    });

    it("AC6: muestra el banner de ruta no optimizada / degradada cuando optimized es false", async () => {
      const degradedRoute: CarrierRoute = {
        ...sampleRoute,
        optimized: false,
        disclaimer: "Ruta ordenada por defecto (servicio no disponible).",
      };

      const { getByTestId, getByText } = await render(
        <StopList route={degradedRoute} />
      );

      expect(getByTestId("unoptimized-route-banner")).toBeTruthy();
      expect(getByText("Orden por defecto (no optimizado)")).toBeTruthy();
      expect(getByText(/Ruta ordenada por defecto/)).toBeTruthy();
    });

    it("muestra aviso toast al tocar una parada futura (orden estricto) y permite navegar a envío de la activa", async () => {
      const onSelectStop = jest.fn();
      const onPressShipment = jest.fn();

      const { getByTestId, getByText } = await render(
        <StopList
          route={sampleRoute}
          activeStopOrder={1}
          onSelectStop={onSelectStop}
          onPressShipment={onPressShipment}
        />
      );

      // Expandir lista para ver paradas futuras
      await fireEvent.press(getByTestId("stop-list-toggle-sheet"));

      // Tocar parada futura 2 dispara toast según regla de Claude Design
      await fireEvent.press(getByTestId("stop-row-2"));
      expect(getByTestId("stop-list-toast")).toBeTruthy();
      expect(getByText(/Primero completá la parada 1/)).toBeTruthy();
      expect(onSelectStop).not.toHaveBeenCalled();

      // Tocar "Ver envío" en la parada activa 1
      await fireEvent.press(getByTestId("stop-shipment-link-1"));
      expect(onPressShipment).toHaveBeenCalledWith("ship-101");
    });

    it("renderiza correctamente cuando una parada está activa (activeStopOrder)", async () => {
      const { getByTestId } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} />
      );

      const stopRow1 = getByTestId("stop-row-1");
      expect(stopRow1).toBeTruthy();
      expect(stopRow1.props.style).toEqual(
        expect.objectContaining({
          borderWidth: 1.5,
        })
      );
    });
  });

  describe("RouteMap", () => {
    it("AC2/AC3: renderiza marcadores de paradas ordenadas, origen y posición del transportista", async () => {
      const carrierLocation = { lat: -31.4167, lng: -64.1833 };
      const originLocation = { lat: -31.3533, lng: -64.2562 };
      const { getByTestId } = await render(
        <RouteMap
          carrierLocation={carrierLocation}
          originLocation={originLocation}
          stops={sampleRoute.stops}
        />
      );

      expect(getByTestId("carrier-current-location-marker")).toBeTruthy();
      expect(getByTestId("route-map-origin-marker")).toBeTruthy();
      expect(getByTestId("route-map-recenter")).toBeTruthy();
      expect(getByTestId("route-map-stop-1")).toBeTruthy();
      expect(getByTestId("route-map-stop-2")).toBeTruthy();
      expect(getByTestId("route-map-stop-3")).toBeTruthy();
    });

    it("muestra botón de restablecer recorrido cuando hay una parada seleccionada", async () => {
      const onResetFocus = jest.fn();
      const { getByTestId } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
          selectedStopOrder={2}
          onResetFocus={onResetFocus}
        />
      );

      expect(getByTestId("route-map-reset-zoom")).toBeTruthy();
      await fireEvent.press(getByTestId("route-map-reset-zoom"));
      expect(onResetFocus).toHaveBeenCalledTimes(1);
    });

    it("muestra tooltip flotante al presionar el marcador de ubicación del transportista", async () => {
      const { getByTestId, queryByTestId, getByText } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
        />
      );

      expect(queryByTestId("route-map-tooltip-courier")).toBeNull();
      await fireEvent.press(getByTestId("carrier-current-location-marker"));
      expect(getByTestId("route-map-tooltip-courier")).toBeTruthy();
      expect(getByText("Tu ubicación actual")).toBeTruthy();
      expect(getByText("En camino a la próxima parada")).toBeTruthy();
    });
  });
});
