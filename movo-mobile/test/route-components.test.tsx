import React from "react";
import { Linking, RefreshControl } from "react-native";
import { render, fireEvent, act } from "@testing-library/react-native";
import { formatDuration, StopList } from "../components/route/stop-list";
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

      // AC11: Formato de ETA aprox. en horas y minutos (ej: +1h50min)
      expect(getByTestId("stop-eta-1").props.children).toMatch(/aprox/);
      expect(getByTestId("stop-eta-3").props.children).toMatch(/\+1h50min aprox/);
    });

    it("renderiza el drag handle superior táctil para arrastrar o expandir", async () => {
      const { getByTestId, getByText } = await render(
        <StopList route={sampleRoute} />
      );

      expect(getByTestId("stop-list-drag-handle")).toBeTruthy();
      await fireEvent.press(getByTestId("stop-list-toggle-sheet"));
      expect(getByText(/Itinerario · 3 paradas/)).toBeTruthy();
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

    it("permite seleccionar cualquier parada, abre su detalle con 'Ver envío' y omite el botón de acción si no es la próxima", async () => {
      const onSelectStop = jest.fn();
      const onPressShipment = jest.fn();

      const { getByTestId, queryByTestId } = await render(
        <StopList
          route={sampleRoute}
          activeStopOrder={1}
          selectedStopOrder={1}
          onSelectStop={onSelectStop}
          onPressShipment={onPressShipment}
          isExpanded={true}
        />
      );

      // Por default la parada activa 1 está destacada y abierta (ambos botones)
      expect(getByTestId("stop-shipment-link-1")).toBeTruthy();
      expect(getByTestId("stop-action-btn-1")).toBeTruthy();
      expect(queryByTestId("stop-shipment-link-2")).toBeNull();
      expect(queryByTestId("stop-action-btn-2")).toBeNull();

      // Tocar parada futura 2 dispara onSelectStop
      await fireEvent.press(getByTestId("stop-row-2"));
      expect(onSelectStop).toHaveBeenCalledWith(sampleRoute.stops[1]);
    });

    it("en paradas seleccionadas que no son la próxima solo renderiza 'Ver envío' (sin botón de retirar/entregar)", async () => {
      const onPressShipment = jest.fn();

      const { getByTestId, queryByTestId } = await render(
        <StopList
          route={sampleRoute}
          activeStopOrder={1}
          selectedStopOrder={2}
          onPressShipment={onPressShipment}
          isExpanded={true}
        />
      );

      // Parada 2 está seleccionada: muestra "Ver envío" pero NO "Retirar paquete" ni "Entregar paquete"
      expect(getByTestId("stop-shipment-link-2")).toBeTruthy();
      expect(queryByTestId("stop-action-btn-2")).toBeNull();

      // Parada 1 no está seleccionada: sus botones están cerrados
      expect(queryByTestId("stop-shipment-link-1")).toBeNull();
      expect(queryByTestId("stop-action-btn-1")).toBeNull();

      // Navegación a ver envío funciona desde la parada 2
      await fireEvent.press(getByTestId("stop-shipment-link-2"));
      expect(onPressShipment).toHaveBeenCalledWith("ship-101");
    });

    it("aplica resaltado y accessibilityState.selected cuando la parada coincide con selectedStopOrder (AC4)", async () => {
      const { getByTestId } = await render(
        <StopList
          route={sampleRoute}
          activeStopOrder={1}
          selectedStopOrder={2}
          isExpanded={true}
        />
      );

      expect(getByTestId("stop-row-2").props.accessibilityState.selected).toBe(true);
      expect(getByTestId("stop-row-1").props.accessibilityState.selected).toBe(false);
    });

    it("AC9: al presionar el CTA principal de la parada activa dispara onPressAction", async () => {
      const onPressAction = jest.fn();
      const onPressShipment = jest.fn();

      const { getByTestId } = await render(
        <StopList
          route={sampleRoute}
          activeStopOrder={1}
          onPressAction={onPressAction}
          onPressShipment={onPressShipment}
        />
      );

      await fireEvent.press(getByTestId("stop-action-btn-1"));
      expect(onPressAction).toHaveBeenCalledTimes(1);
      expect(onPressAction).toHaveBeenCalledWith(sampleRoute.stops[0]);
      expect(onPressShipment).not.toHaveBeenCalled();
    });

    it("con isActionDisabled, el CTA de la parada activa no dispara onPressAction y dice un label según el tipo de parada", async () => {
      const onPressAction = jest.fn();

      // stopOrder 1 es un retiro (sampleRoute.stops[0].type === "pickup"), así que
      // deshabilitado debería decir "Retiro no disponible", no "Entrega
      // próximamente" (bug de label fijo, feedback de review, PR #180).
      const { getByTestId, getByText } = await render(
        <StopList
          route={sampleRoute}
          activeStopOrder={1}
          onPressAction={onPressAction}
          isActionDisabled={() => true}
        />
      );

      await fireEvent.press(getByTestId("stop-action-btn-1"));
      expect(onPressAction).not.toHaveBeenCalled();
      expect(getByText("Retiro no disponible")).toBeTruthy();
    });

    it("con isActionDisabled sobre una parada de entrega, dice 'Entrega próximamente'", async () => {
      const onPressAction = jest.fn();

      const { getByTestId, getByText } = await render(
        <StopList
          route={sampleRoute}
          activeStopOrder={2}
          onPressAction={onPressAction}
          isActionDisabled={() => true}
        />
      );

      await fireEvent.press(getByTestId("stop-action-btn-2"));
      expect(onPressAction).not.toHaveBeenCalled();
      expect(getByText("Entrega próximamente")).toBeTruthy();
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

    it("renderiza chips coherentes con los nodos del mapa (retiro cuadrado, entrega círculo, fondo negro sin borde incompleto)", async () => {
      const { getByTestId } = await render(
        <StopList route={sampleRoute} isExpanded={true} />
      );

      // Parada 1 (retiro): cuadrado redondeado (radius 8), fondo #0A0A0B
      const chip1 = getByTestId("stop-chip-1");
      expect(chip1.props.style).toEqual(
        expect.objectContaining({
          borderRadius: 8,
          backgroundColor: "#0A0A0B",
        })
      );

      // Parada 3 (entrega): círculo completo (radius 999), fondo #0A0A0B
      const chip3 = getByTestId("stop-chip-3");
      expect(chip3.props.style).toEqual(
        expect.objectContaining({
          borderRadius: 999,
          backgroundColor: "#0A0A0B",
        })
      );

      // Parada 2 (demora / retraso): círculo completo (radius 999), fondo #E5484D (rojo)
      const chip2 = getByTestId("stop-chip-2");
      expect(chip2.props.style).toEqual(
        expect.objectContaining({
          borderRadius: 999,
          backgroundColor: "#E5484D",
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

    it("muestra botón de restablecer recorrido ('Ver ruta') tras centrar y conmuta de regreso al presionar", async () => {
      const onResetFocus = jest.fn();
      const { getByTestId, queryByTestId } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
          onResetFocus={onResetFocus}
        />
      );

      // Estado natural: muestra "Centrar"
      expect(getByTestId("route-map-recenter")).toBeTruthy();
      expect(queryByTestId("route-map-reset-zoom")).toBeNull();

      // Al centrar: pasa a mostrar "Ver ruta"
      await fireEvent.press(getByTestId("route-map-recenter"));
      expect(getByTestId("route-map-reset-zoom")).toBeTruthy();
      expect(queryByTestId("route-map-recenter")).toBeNull();

      // Al presionar "Ver ruta": ejecuta reset de cámara y vuelve a "Centrar"
      await fireEvent.press(getByTestId("route-map-reset-zoom"));
      expect(onResetFocus).toHaveBeenCalledTimes(1);
      expect(getByTestId("route-map-recenter")).toBeTruthy();
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

    it("aplica estilos y formas del artefacto de Claude Design (origen con punto, transportista lima, retiro cuadrado, entrega círculo)", async () => {
      const carrierLocation = { lat: -31.4167, lng: -64.1833 };
      const originLocation = { lat: -31.3533, lng: -64.2562 };
      const { getByTestId } = await render(
        <RouteMap
          carrierLocation={carrierLocation}
          originLocation={originLocation}
          stops={sampleRoute.stops}
        />
      );

      // Origen: Círculo blanco con punto interno
      const originMarker = getByTestId("route-map-origin-marker");
      expect(originMarker).toBeTruthy();
      const originView = originMarker.props.children;
      expect(originView.props.style).toEqual(
        expect.objectContaining({
          borderRadius: 999,
          backgroundColor: "#FFFFFF",
          borderColor: "#0A0A0B",
        })
      );

      // Transportista: Círculo verde lima con borde blanco
      const courierMarker = getByTestId("carrier-current-location-marker");
      expect(courierMarker).toBeTruthy();
      const courierView = courierMarker.props.children;
      expect(courierView.props.style).toEqual(
        expect.objectContaining({
          borderRadius: 999,
          backgroundColor: "#C6F24A",
          borderColor: "#FFFFFF",
        })
      );

      // Parada 1 (retiro): Cuadrado redondeado (borderRadius: 8, 28x28), fondo negro, borde blanco sencillo
      const stop1 = getByTestId("route-map-stop-1");
      expect(stop1).toBeTruthy();
      const stop1View = stop1.props.children;
      expect(stop1View.props.style).toEqual(
        expect.objectContaining({
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: "#0A0A0B",
          borderColor: "#FFFFFF",
        })
      );

      // Parada 3 (entrega): Círculo (borderRadius: 999, 28x28), fondo negro, borde blanco
      const stop3 = getByTestId("route-map-stop-3");
      expect(stop3).toBeTruthy();
      const stop3View = stop3.props.children;
      expect(stop3View.props.style).toEqual(
        expect.objectContaining({
          width: 28,
          height: 28,
          borderRadius: 999,
          backgroundColor: "#0A0A0B",
          borderColor: "#FFFFFF",
        })
      );
    });

    it("muestra un solo botón a la vez alternando entre 'Centrar' y 'Ver ruta' según el seguimiento del conductor", async () => {
      const onResetFocus = jest.fn();
      const { getByTestId, queryByTestId, getByText } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
          onResetFocus={onResetFocus}
        />
      );

      // Estado natural (overview): solo se muestra "Centrar"
      expect(getByTestId("route-map-recenter")).toBeTruthy();
      expect(getByText("Centrar")).toBeTruthy();
      expect(queryByTestId("route-map-reset-zoom")).toBeNull();

      // Al presionar "Centrar", pasa a seguimiento y el botón conmuta a "Ver ruta"
      await act(async () => {
        fireEvent.press(getByTestId("route-map-recenter"));
      });
      expect(getByTestId("route-map-reset-zoom")).toBeTruthy();
      expect(getByText("Ver ruta")).toBeTruthy();
      expect(queryByTestId("route-map-recenter")).toBeNull();

      // Al mover el mapa manualmente (onPanDrag), se pierde el seguimiento continuo y vuelve a "Centrar"
      const mapView = getByTestId("route-mapview");
      await act(async () => {
        mapView.props.onPanDrag?.();
      });
      expect(getByTestId("route-map-recenter")).toBeTruthy();
      expect(getByText("Centrar")).toBeTruthy();
      expect(queryByTestId("route-map-reset-zoom")).toBeNull();

      // Al presionar "Centrar" de nuevo y luego "Ver ruta", regresa a vista general
      await act(async () => {
        fireEvent.press(getByTestId("route-map-recenter"));
      });
      expect(getByTestId("route-map-reset-zoom")).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId("route-map-reset-zoom"));
      });
      expect(getByTestId("route-map-recenter")).toBeTruthy();
      expect(onResetFocus).toHaveBeenCalledTimes(1);
    });

    it("renderiza botón 'Abrir en Maps' y activa feedback toast e interactividad de navegación", async () => {
      jest.useFakeTimers();
      const openURLSpy = jest.spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve());

      const { getByTestId, getByText, queryByTestId } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
          activeStopOrder={1}
        />
      );

      // Control flotante "Abrir en Maps" con subtítulo
      const openMapsBtn = getByTestId("route-map-open-maps");
      expect(openMapsBtn).toBeTruthy();
      expect(getByText("Abrir en Maps")).toBeTruthy();
      expect(getByText("GPS paso a paso")).toBeTruthy();

      // Toast no visible al inicio
      expect(queryByTestId("route-navigation-toast")).toBeNull();

      // Al presionar, abre el enlace y muestra el toast de éxito
      await act(async () => {
        fireEvent.press(openMapsBtn);
      });

      expect(openURLSpy).toHaveBeenCalledTimes(1);
      expect(openURLSpy.mock.calls[0][0]).toContain("https://www.google.com/maps/dir/");
      expect(openURLSpy.mock.calls[0][0]).toContain("-31.425"); // lat de parada 1

      expect(getByTestId("route-navigation-toast")).toBeTruthy();
      expect(getByText("Iniciando navegación con Google Maps...")).toBeTruthy();

      // Al expirar el tiempo del toast (2400ms), desaparece
      await act(async () => {
        jest.advanceTimersByTime(2500);
      });
      expect(queryByTestId("route-navigation-toast")).toBeNull();

      openURLSpy.mockRestore();
      jest.useRealTimers();
    });

    it("muestra feedback de error si el sistema no puede abrir la app de mapas externa", async () => {
      jest.useFakeTimers();
      const openURLSpy = jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("No app available"));

      const { getByTestId, getByText, queryByTestId } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
          activeStopOrder={1}
        />
      );

      const openMapsBtn = getByTestId("route-map-open-maps");
      await act(async () => {
        fireEvent.press(openMapsBtn);
      });

      expect(openURLSpy).toHaveBeenCalledTimes(1);
      expect(getByTestId("route-navigation-toast")).toBeTruthy();
      expect(getByText("No se pudo abrir la navegación externa.")).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(3100);
      });
      expect(queryByTestId("route-navigation-toast")).toBeNull();

      openURLSpy.mockRestore();
      jest.useRealTimers();
    });

    it("abre en Google Maps el recorrido completo con todas las paradas secuenciadas mediante waypoints y destino final", async () => {
      const openURLSpy = jest.spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve());

      const { getByTestId } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
          activeStopOrder={1}
        />
      );

      await act(async () => {
        fireEvent.press(getByTestId("route-map-open-maps"));
      });

      expect(openURLSpy).toHaveBeenCalledTimes(1);
      const calledUrl = openURLSpy.mock.calls[0][0];

      // Incluye origen con posición del transportista
      expect(calledUrl).toContain("origin=-31.4167,-64.1833");
      // Incluye parada 3 como destino final
      expect(calledUrl).toContain("destination=-32.0416%2C-63.5698");
      // Incluye paradas 1 y 2 como waypoints secuenciados intermedios
      expect(calledUrl).toContain("waypoints=-31.425,-64.187%7C-31.9139,-63.6817");
      expect(calledUrl).toContain("travelmode=driving");

      openURLSpy.mockRestore();
    });

    it("al presionar un marcador de parada en el mapa llama a onSelectStop para destacarla en el bottom sheet", async () => {
      const onSelectStop = jest.fn();
      const { getByTestId } = await render(
        <RouteMap
          carrierLocation={{ lat: -31.4167, lng: -64.1833 }}
          stops={sampleRoute.stops}
          activeStopOrder={1}
          onSelectStop={onSelectStop}
        />
      );

      await fireEvent.press(getByTestId("route-map-stop-2"));
      expect(onSelectStop).toHaveBeenCalledWith(sampleRoute.stops[1]);
    });
  });

  describe("Funciones auxiliares y formato de StopList", () => {
    it("formatDuration formatea minutos en horas y minutos (ej: 115 min a 1h55min)", () => {
      expect(formatDuration(115)).toBe("1h55min");
      expect(formatDuration(45)).toBe("45 min");
      expect(formatDuration(60)).toBe("1h");
      expect(formatDuration(120)).toBe("2h");
      expect(formatDuration(61)).toBe("1h1min");
    });

    it("configura el spinner de refresco del bottom sheet en color negro (#0A0A0B)", async () => {
      const onRefresh = jest.fn();
      const { toJSON } = await render(
        <StopList route={sampleRoute} onRefresh={onRefresh} isRefreshing={false} />
      );

      const findNode = (node: any, type: string): any => {
        if (!node) return null;
        if (node.type === type) return node;
        if (node.children) {
          for (const c of node.children) {
            const found = findNode(c, type);
            if (found) return found;
          }
        }
        return null;
      };

      const scrollViewNode = findNode(toJSON(), "RCTScrollView");
      expect(scrollViewNode).toBeTruthy();
      const refreshControlElement = scrollViewNode.props.refreshControl;
      expect(refreshControlElement).toBeTruthy();
      expect(refreshControlElement.props.tintColor).toBe("#0A0A0B");
      expect(refreshControlElement.props.colors).toEqual(["#0A0A0B"]);
    });
  });
});
