import React from "react";
import { Linking, RefreshControl } from "react-native";
import { render, fireEvent, act } from "@testing-library/react-native";
import { formatDuration, StopList } from "../components/route/stop-list";
import { RouteMap } from "../components/route/route-map";
import type { CarrierRoute } from "@movo/shared/dist/types/routing";

const mockCounterpartName = jest.fn<string | null, [unknown]>(() => null);
jest.mock("../src/hooks/use-stop-counterpart", () => ({
  useStopCounterpartName: (stop: unknown) => mockCounterpartName(stop),
}));

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
    beforeEach(() => {
      mockCounterpartName.mockReset();
      mockCounterpartName.mockReturnValue(null);
    });

    it("colapsado: solo la card de la próxima parada, completa, con su botonera, y reporta su alto", async () => {
      const onCollapsedHeightChange = jest.fn();
      const { getByTestId, queryByTestId, getByText } = await render(
        <StopList
          route={{ ...sampleRoute, optimized: false }}
          activeStopOrder={1}
          onPressShipment={jest.fn()}
          onCollapsedHeightChange={onCollapsedHeightChange}
        />
      );

      expect(getByText(/Próxima parada · 1 de 3/)).toBeTruthy();
      expect(getByTestId("stop-row-1")).toBeTruthy();
      expect(getByText("Av. Colón 1200")).toBeTruthy();
      expect(queryByTestId("stop-row-2")).toBeNull();
      expect(queryByTestId("stop-row-3")).toBeNull();
      expect(getByTestId("stop-shipment-link-1")).toBeTruthy();
      expect(getByTestId("stop-navigate-btn-1")).toBeTruthy();
      expect(getByTestId("stop-action-btn-1")).toBeTruthy();
      // Sin banner de ruta no optimizada mientras está colapsado
      expect(queryByTestId("unoptimized-route-banner")).toBeNull();

      // Alto colapsado = encabezado + padding superior (28) + card ancla + padding inferior
      // (insets 0 en test → 16 + 12 = 28). Ninguno depende de la animación de abrir/cerrar.
      await fireEvent(getByTestId("stop-list-header"), "layout", {
        nativeEvent: { layout: { height: 70, width: 390, x: 0, y: 0 } },
      });
      await fireEvent(getByTestId("stop-list-anchor"), "layout", {
        nativeEvent: { layout: { height: 300, width: 350, x: 20, y: 28 } },
      });
      expect(onCollapsedHeightChange).toHaveBeenLastCalledWith(70 + 28 + 300 + 28);
    });

    it("al abrir despliega el resto de la ruta alrededor de la card ancla y cambia el encabezado a 'Tu ruta'", async () => {
      const { getByTestId, getByText } = await render(<StopList route={sampleRoute} activeStopOrder={1} />);

      expect(getByTestId("stop-list-drag-handle")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("stop-list-toggle-sheet"));
      });

      expect(getByText("Tu ruta")).toBeTruthy();
      expect(getByText(/3 paradas · 42.8 km · horarios aprox\./)).toBeTruthy();
      expect(getByTestId("stop-row-2")).toBeTruthy();
      expect(getByText("San Martín 450")).toBeTruthy();
      expect(getByTestId("stop-row-3")).toBeTruthy();
    });

    it("AC11: la card ancla muestra el ETA con 'aprox.' y las filas compactas la hora corta", async () => {
      const { getByTestId } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} isExpanded={true} />
      );

      expect(getByTestId("stop-eta-1").props.children).toMatch(/aprox\.$/);
      expect(getByTestId("stop-eta-3").props.children).toBe("+1h50min");
    });

    it("AC4: la card ancla muestra la ventana horaria de la parada", async () => {
      const { getByText } = await render(<StopList route={sampleRoute} activeStopOrder={1} />);
      expect(getByText(/^Ventana /)).toBeTruthy();
    });

    it("AC5: marca 'Fuera de ventana' en la parada demorada", async () => {
      const { getByTestId, queryByTestId } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} isExpanded={true} />
      );

      expect(queryByTestId("stop-late-badge-1")).toBeNull();
      expect(getByTestId("stop-late-badge-2")).toBeTruthy();
    });

    it("AC6: muestra el banner de ruta no optimizada con la ruta abierta", async () => {
      const degradedRoute: CarrierRoute = {
        ...sampleRoute,
        optimized: false,
        disclaimer: "Ruta ordenada por defecto (servicio no disponible).",
      };

      const { getByTestId, getByText } = await render(
        <StopList route={degradedRoute} isExpanded={true} />
      );

      expect(getByTestId("unoptimized-route-banner")).toBeTruthy();
      expect(getByText("Orden por defecto (no optimizado)")).toBeTruthy();
      expect(getByText(/Ruta ordenada por defecto/)).toBeTruthy();
    });

    it("reemplaza el ID del envío por la persona: 'Retirás de' / 'Entregás a' + nombre", async () => {
      mockCounterpartName.mockImplementation((stop) =>
        (stop as { type: string }).type === "pickup" ? "Martina" : "Julia"
      );
      const { getByText, getAllByText } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} isExpanded={true} />
      );

      expect(getByText("Retirás de")).toBeTruthy();
      expect(getByText("Martina")).toBeTruthy();
      expect(getAllByText("Entregás a Julia").length).toBe(2);
    });

    it("sin nombre todavía muestra solo la acción, sin inventar a la persona", async () => {
      const { getByText } = await render(<StopList route={sampleRoute} activeStopOrder={1} />);
      expect(getByText("Retirás el paquete")).toBeTruthy();
    });

    it("tocar una fila la selecciona (pasa a ser la card ancla)", async () => {
      const onSelectStop = jest.fn();
      const { getByTestId } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} onSelectStop={onSelectStop} isExpanded={true} />
      );

      await fireEvent.press(getByTestId("stop-row-2"));
      expect(onSelectStop).toHaveBeenCalledWith(sampleRoute.stops[1]);
    });

    it("con otra parada seleccionada, la ancla es esa: 'Ver envío' y 'Navegar' pero sin CTA de retiro/entrega", async () => {
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

      expect(getByTestId("stop-row-2").props.accessibilityState.selected).toBe(true);
      expect(getByTestId("stop-row-1").props.accessibilityState.selected).toBe(false);
      expect(getByTestId("stop-shipment-link-2")).toBeTruthy();
      expect(getByTestId("stop-navigate-btn-2")).toBeTruthy();
      expect(queryByTestId("stop-action-btn-2")).toBeNull();
      expect(queryByTestId("stop-shipment-link-1")).toBeNull();

      await fireEvent.press(getByTestId("stop-shipment-link-2"));
      expect(onPressShipment).toHaveBeenCalledWith("ship-101");
    });

    it("con otra parada seleccionada y colapsado, el encabezado dice 'Parada N de M' en vez de 'Próxima parada'", async () => {
      const { getByText } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} selectedStopOrder={3} />
      );
      expect(getByText(/^Parada · 3 de 3$/)).toBeTruthy();
    });

    it("MOVO-237: 'Navegar' abre el deep-link a las coordenadas de la card ancla", async () => {
      const openURLSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

      const { getByTestId } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} selectedStopOrder={2} />
      );
      await act(async () => {
        fireEvent.press(getByTestId("stop-navigate-btn-2"));
      });

      expect(openURLSpy).toHaveBeenCalledTimes(1);
      expect(openURLSpy.mock.calls[0][0]).toContain("-31.9139,-63.6817");
      openURLSpy.mockRestore();
    });

    it("AC9: el CTA principal de la próxima parada dispara onPressAction", async () => {
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
      expect(onPressAction).toHaveBeenCalledWith(sampleRoute.stops[0]);
      expect(onPressShipment).not.toHaveBeenCalled();
    });

    it("con isActionDisabled sobre un retiro, el CTA no dispara onPressAction y dice 'Retiro no disponible'", async () => {
      const onPressAction = jest.fn();
      const { getByTestId, getByText } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} onPressAction={onPressAction} isActionDisabled={() => true} />
      );

      await fireEvent.press(getByTestId("stop-action-btn-1"));
      expect(onPressAction).not.toHaveBeenCalled();
      expect(getByText("Retiro no disponible")).toBeTruthy();
    });

    it("con isActionDisabled sobre una entrega, dice 'Entrega próximamente'", async () => {
      const { getByText } = await render(
        <StopList route={sampleRoute} activeStopOrder={2} isActionDisabled={() => true} />
      );
      expect(getByText("Entrega próximamente")).toBeTruthy();
    });

    it("las filas usan la forma de los marcadores del mapa (entrega círculo) y rojo si hay demora", async () => {
      const { getByTestId } = await render(
        <StopList route={sampleRoute} activeStopOrder={1} isExpanded={true} />
      );

      expect(getByTestId("stop-chip-3").props.style).toEqual(expect.objectContaining({ borderRadius: 999 }));
      expect(getByTestId("stop-chip-2").props.style).toEqual(
        expect.objectContaining({ borderRadius: 999, backgroundColor: "#E5484D" })
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
      expect(getByText("Ver ruta completa")).toBeTruthy();

      // Toast no visible al inicio
      expect(queryByTestId("route-navigation-toast")).toBeNull();

      // Al presionar, abre el enlace y muestra el toast de éxito
      await act(async () => {
        fireEvent.press(openMapsBtn);
      });

      expect(openURLSpy).toHaveBeenCalledTimes(1);
      // Misma cascada que "Navegar": primero el deep-link nativo de Google Maps (iOS)
      expect(openURLSpy.mock.calls[0][0]).toContain("comgooglemaps://");
      expect(openURLSpy.mock.calls[0][0]).toContain("-31.425"); // lat de parada 1

      expect(getByTestId("route-navigation-toast")).toBeTruthy();
      expect(getByText("Abriendo el recorrido en tu app de mapas...")).toBeTruthy();

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
      const openURLSpy = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("No app available"));

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

      // Prueba toda la cascada (Google Maps nativo → Waze → web) antes de avisar el error
      expect(openURLSpy).toHaveBeenCalledTimes(3);
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

      // Primera candidata de la cascada (iOS en jest): deep-link nativo de Google Maps
      expect(openURLSpy).toHaveBeenCalledTimes(1);
      const calledUrl = openURLSpy.mock.calls[0][0];

      // Origen con la posición del transportista
      expect(calledUrl).toContain("saddr=-31.4167,-64.1833");
      // Paradas 1, 2 y 3 (destino final) encadenadas en orden
      expect(calledUrl).toContain("daddr=-31.425,-64.187+to:-31.9139,-63.6817+to:-32.0416,-63.5698");
      expect(calledUrl).toContain("directionsmode=driving");

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
        <StopList route={sampleRoute} onRefresh={onRefresh} isRefreshing={false} isExpanded={true} />
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
