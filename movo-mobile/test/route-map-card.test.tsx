import { fireEvent, render, renderHook } from "@testing-library/react-native";
import { Text } from "react-native";
import { RouteMapCard } from "../components/send/route-map-card";
import { useThemeColors } from "../src/hooks/use-theme-colors";

// `ExpandableMap` abre midiendo la card con `measureInWindow`, que no dispara en jest-expo (ver
// `avatar-peek-viewer.test.tsx`). Se reemplaza por uno que monta la pantalla completa al tocar el
// botón (o al montar con `openOnMount`): estos tests verifican qué dibuja RouteMapCard ahí.
jest.mock("../components/map/expandable-map", () => {
  const React = require("react");
  const { Pressable, View } = require("react-native");
  return {
    ExpandableMap: ({
      children,
      renderFullscreen,
      openOnMount,
      onOpenedOnMount,
      onVisibleChange,
      testID,
    }: {
      children: unknown;
      renderFullscreen: (close: (then?: () => void) => void) => unknown;
      openOnMount?: boolean;
      onOpenedOnMount?: () => void;
      onVisibleChange?: (visible: boolean) => void;
      testID?: string;
    }) => {
      const [open, setOpen] = React.useState(Boolean(openOnMount));
      React.useEffect(() => {
        if (openOnMount) onOpenedOnMount?.();
      }, []);
      React.useEffect(() => {
        onVisibleChange?.(open);
      }, [open, onVisibleChange]);
      return (
        <View testID={testID}>
          {children}
          <Pressable testID={testID ? `${testID}-expand` : undefined} onPress={() => setOpen(true)} />
          {open
            ? renderFullscreen((then?: () => void) => {
                setOpen(false);
                then?.();
              })
            : null}
        </View>
      );
    },
  };
});

// El mock oficial de Reanimated no incluye `useFrameCallback`; acá alcanza con un
// callback inactivo (el barrido animado no se verifica en Jest). Tampoco `useReducedMotion`,
// que usa `SkeletonBlock` (MOVO-168).
jest.mock("react-native-reanimated", () => {
  const mock = require("react-native-reanimated/mock");
  return {
    ...mock,
    default: mock.default,
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: 0 }),
    useReducedMotion: () => false,
  };
});

const mockUseShipmentRoute = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipmentRoute: () => mockUseShipmentRoute(),
}));

const PICKUP = { address: "Av. Colón 1000", lat: -31.41, lng: -64.19 };
const DELIVERY = { address: "Bv. San Juan 500", lat: -31.42, lng: -64.18 };
// "_p~iF~ps|U_ulLnnqC_mqNvxq`@": ejemplo canónico de Google, decodifica a 3 puntos.
const ROUTE = { polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", distanceMeters: 1500, durationSeconds: 300 };

function baseCoordinates(getByTestId: (id: string) => { props: Record<string, unknown> }) {
  return getByTestId("map-route-base").props.coordinates as unknown[];
}

describe("RouteMapCard", () => {
  beforeEach(() => mockUseShipmentRoute.mockReset());

  it("ofrece expandir el mapa a pantalla completa", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
    const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />);

    expect(getByTestId("map-frame-expand")).toBeTruthy();
  });

  it("mientras la ruta carga no dibuja la recta y tapa el mapa con un skeleton", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
    const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />);

    expect(getByTestId("map-route-loading")).toBeTruthy();
    expect(baseCoordinates(getByTestId)).toEqual([]);
  });

  it("con la ruta real dibuja el trazo por calle y saca el skeleton", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
    const { getByTestId, queryByTestId } = await render(
      <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />,
    );

    expect(queryByTestId("map-route-loading")).toBeNull();
    expect(baseCoordinates(getByTestId)).toHaveLength(3);
  });

  it("si la ruta falla cae a la recta entre los dos puntos", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: true });
    const { getByTestId, queryByTestId } = await render(
      <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />,
    );

    expect(queryByTestId("map-route-loading")).toBeNull();
    const coords = baseCoordinates(getByTestId);
    expect(coords[0]).toEqual({ latitude: PICKUP.lat, longitude: PICKUP.lng });
    expect(coords[coords.length - 1]).toEqual({ latitude: DELIVERY.lat, longitude: DELIVERY.lng });
  });

  it("con pickup null y pickupLabel muestra solo la entrega y el origen como texto (MOVO-194 AC4)", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
    const { getByTestId, queryByTestId, queryByText } = await render(
      <RouteMapCard testID="map" pickup={null} pickupLabel="Av. Colón 1000" delivery={DELIVERY} />,
    );

    expect(getByTestId("map-map")).toBeTruthy();
    expect(getByTestId("map-pickup-label")).toHaveTextContent("Retiro en Av. Colón 1000");
    expect(queryByTestId("map-route-base")).toBeNull();
    expect(queryByTestId("map-route-loading")).toBeNull();
    expect(queryByText("Bv. San Juan 500")).toBeTruthy();
  });

  it("sin pickup ni pickupLabel sigue mostrando el estado vacío", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
    const { getByText } = await render(<RouteMapCard testID="map" pickup={null} delivery={DELIVERY} />);

    expect(getByText("Definí el origen y destino para ver la ruta")).toBeTruthy();
  });

  describe("MOVO-346: seguimiento en vivo sobre el mismo mapa", () => {
    const TRACE = [
      { latitude: PICKUP.lat, longitude: PICKUP.lng },
      { latitude: -31.415, longitude: -64.185 },
    ];

    it("dibuja el recorrido, lo que falta desde el transportista y su marcador", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const live = { position: { lat: -31.415, lng: -64.185 }, stale: false, trace: TRACE, planned: [] };
      const { getByTestId, queryByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live} />,
      );

      // El recorrido termina en el transportista. Lo que falta va en gris continuo; como el transportista
      // está lejos de la ruta del fixture, arranca en su proyección y no en él (sin una recta que las una).
      expect(getByTestId("map-trace").props.coordinates).toEqual([...TRACE, { latitude: -31.415, longitude: -64.185 }]);
      const remaining = getByTestId("map-remaining").props.coordinates as unknown[];
      expect(remaining.length).toBeGreaterThan(1);
      expect(remaining[0]).not.toEqual({ latitude: -31.415, longitude: -64.185 });
      expect(getByTestId("map-remaining").props.lineDashPattern).toBeUndefined();
      expect(getByTestId("map-carrier")).toBeTruthy();
      expect(queryByTestId("map-last-signal")).toBeNull();
      // Una sola ruta: sin la línea base debajo (era la "doble línea" del feedback de la build 18).
      expect(queryByTestId("map-route-base")).toBeNull();
    });

    it("sin posición todavía no anima el barrido de la otra ruta debajo de la del seguimiento", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const live = { position: null, stale: false, trace: [], planned: [], phase: "pickup" as const };
      const { getByTestId, queryByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live} />,
      );

      expect(getByTestId("map-remaining")).toBeTruthy();
      expect(queryByTestId("map-route-base")).toBeNull();
      expect(queryByTestId("map-route-sweep")).toBeNull();
    });

    it("sin seguimiento en vivo, la base y el barrido siguen", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />);

      expect(getByTestId("map-route-base")).toBeTruthy();
      expect(getByTestId("map-route-sweep")).toBeTruthy();
    });

    it("antes del retiro dibuja la ruta entera, sin recortarla desde el transportista", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const live = { position: { lat: -31.3, lng: -64.3 }, stale: false, trace: [], planned: [], phase: "pickup" as const };
      const { getByTestId, queryByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live} />,
      );

      const remaining = getByTestId("map-remaining").props.coordinates as Array<{ latitude: number; longitude: number }>;
      expect(remaining[0]).not.toEqual({ latitude: -31.3, longitude: -64.3 });
      expect(queryByTestId("map-trace")).toBeNull();
    });

    it("sin señal muestra la hora de la última", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const live = {
        position: { lat: -31.415, lng: -64.185 },
        stale: true,
        lastSignalLabel: "Última señal 19:10 h",
        trace: [],
        planned: [],
      };
      const { getByText } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live} />);

      expect(getByText("Última señal 19:10 h")).toBeTruthy();
    });

    it("sin retiro a la vista (receptor) no dibuja la traza, que lo delataría", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
      const live = { position: { lat: -31.415, lng: -64.185 }, stale: false, trace: TRACE, planned: [] };
      const { queryByTestId, getByTestId } = await render(
        <RouteMapCard testID="map" pickup={null} pickupLabel="Córdoba" delivery={DELIVERY} live={live} />,
      );

      expect(queryByTestId("map-trace")).toBeNull();
      expect(getByTestId("map-carrier")).toBeTruthy();
    });
  });

  describe("MOVO-355: la línea de la ruta", () => {
    const TRACE = [
      { latitude: PICKUP.lat, longitude: PICKUP.lng },
      { latitude: -31.415, longitude: -64.185 },
    ];
    const LIVE = { position: { lat: -31.415, lng: -64.185 }, stale: false, trace: TRACE, planned: [] };

    it("lo recorrido va encima de lo que falta, en tinta sobre gris y sin punteado", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={LIVE} />);

      const remaining = getByTestId("map-remaining").props;
      const trace = getByTestId("map-trace").props;
      expect(trace.zIndex).toBeGreaterThan(remaining.zIndex);
      const { result } = await renderHook(() => useThemeColors());
      expect(remaining.strokeColor).toBe(result.current.fg3);
      expect(trace.strokeColor).toBe(result.current.fg1);
      expect(remaining.lineDashPattern).toBeUndefined();
      expect(trace.lineDashPattern).toBeUndefined();
    });

    it("a pantalla completa el orden es el mismo", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={LIVE} />);
      await fireEvent.press(getByTestId("map-frame-expand"));

      expect(getByTestId("map-fs-trace").props.zIndex).toBeGreaterThan(getByTestId("map-fs-remaining").props.zIndex);
    });

    it("sin seguimiento, a pantalla completa va la misma base gris con el barrido que en la card", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />);
      await fireEvent.press(getByTestId("map-frame-expand"));

      const cardBase = getByTestId("map-route-base").props;
      const fsBase = getByTestId("map-fs-route-base").props;
      expect(fsBase.strokeColor).toBe(cardBase.strokeColor);
      expect(fsBase.strokeWidth).toBe(cardBase.strokeWidth);
      expect(getByTestId("map-fs-route-sweep").props.zIndex).toBeGreaterThan(fsBase.zIndex);
    });

    it("con la pantalla completa abierta solo se anima ese mapa, y cada mapa tiene su propio animatedProps", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const { getByTestId, queryByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />);
      const cardProps = getByTestId("map-route-sweep").props.animatedProps;
      expect(cardProps).toBeDefined();

      await fireEvent.press(getByTestId("map-frame-expand"));

      const fsProps = getByTestId("map-fs-route-sweep").props.animatedProps;
      expect(fsProps).toBeDefined();
      expect(fsProps).not.toBe(cardProps);
      // La card, tapada por el modal, deja de animar el barrido.
      expect(queryByTestId("map-route-sweep")).toBeNull();
      expect(getByTestId("map-route-base")).toBeTruthy();
    });
  });

  describe("MOVO-359: la ruta del transportista al retiro", () => {
    const P = (latitude: number, longitude: number) => ({ latitude, longitude });
    // Sobre un meridiano: el vehículo al sur del retiro, la entrega al norte.
    const APPROACH = [P(-31.45, -64.2), P(-31.43, -64.2), P(-31.4, -64.2)];
    const PLANNED = [P(-31.4, -64.2), P(-31.35, -64.2), P(-31.3, -64.2)];
    const live = (over: Record<string, unknown> = {}) => ({
      position: { lat: -31.45, lng: -64.2 },
      stale: false,
      trace: [],
      planned: PLANNED,
      approach: APPROACH,
      phase: "pickup" as const,
      ...over,
    });

    it("antes del retiro dibuja una sola línea gris: del vehículo al retiro y de ahí a la entrega", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const { getByTestId, queryByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live()} />,
      );

      const remaining = getByTestId("map-remaining").props.coordinates as unknown[];
      expect(remaining[0]).toEqual(P(-31.45, -64.2));
      // Una sola línea: el tramo al retiro y, a continuación, la planificada entera.
      expect(remaining.slice(-PLANNED.length)).toEqual(PLANNED);
      expect(remaining.slice(0, -PLANNED.length)).toContainEqual(APPROACH[2]);
      expect(queryByTestId("map-trace")).toBeNull();
    });

    it("sin la ruta al retiro dibuja la planificada entera, como antes", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const { getByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live({ approach: [] })} />,
      );

      expect(getByTestId("map-remaining").props.coordinates).toEqual(PLANNED);
    });

    it("la llegada estimada al retiro mide la ruta por calle", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      let estimate: { kind: string; km?: number; target?: string } | undefined;
      const { getByTestId } = await render(
        <RouteMapCard
          testID="map"
          pickup={PICKUP}
          delivery={DELIVERY}
          live={live({ viewer: "sender" })}
          renderFullscreenSheet={(ctx) => {
            estimate = ctx.estimate;
            return null;
          }}
        />,
      );
      await fireEvent.press(getByTestId("map-frame-expand"));

      // 5,6 km del vehículo al retiro sobre el meridiano.
      expect(estimate).toEqual(expect.objectContaining({ kind: "eta", target: "pickup", km: 5.6 }));
    });

    it("al pasar a la entrega el tramo se reinicia: el índice del tramo al retiro no se usa sobre la planificada", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const screen = await render(
        <RouteMapCard
          testID="map"
          pickup={PICKUP}
          delivery={DELIVERY}
          live={live({ position: { lat: -31.41, lng: -64.2 } })}
        />,
      );
      // El auto ya está en el segundo tramo de la ruta al retiro.
      await screen.rerender(
        <RouteMapCard
          testID="map"
          pickup={PICKUP}
          delivery={DELIVERY}
          live={live({ position: { lat: -31.4, lng: -64.2 } })}
        />,
      );
      // Retiró el paquete: sale por el primer tramo de la planificada. Mismas rutas (mismas referencias):
      // solo cambia la etapa, que es lo que tiene que reiniciar el tramo.
      await screen.rerender(
        <RouteMapCard
          testID="map"
          pickup={PICKUP}
          delivery={DELIVERY}
          live={live({ position: { lat: -31.39, lng: -64.2 }, phase: "delivery" })}
        />,
      );

      const remaining = screen.getByTestId("map-remaining").props.coordinates as unknown[];
      // Vehículo, su proyección en el primer tramo y los dos puntos que faltan. Con el índice viejo (1) se
      // saltaba el primer tramo y faltaba un punto.
      expect(remaining).toHaveLength(4);
    });
  });

  describe("MOVO-361: un solo mapa, a pantalla completa con el seguimiento", () => {
    const CARRIER = { lat: -31.415, lng: -64.185 };
    const LIVE = { position: CARRIER, stale: false, trace: [], planned: [] };

    it("el botón de la esquina abre el mismo mapa con el seguimiento y el sheet", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const renderSheet = jest.fn(({ estimate }: { estimate: { kind: string } }) => (
        <Text testID="sheet">{estimate.kind}</Text>
      ));
      const { getByTestId, queryByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={LIVE} renderFullscreenSheet={renderSheet} />,
      );
      expect(queryByTestId("sheet")).toBeNull();

      await fireEvent.press(getByTestId("map-frame-expand"));

      expect(getByTestId("map-fullscreen-map")).toBeTruthy();
      expect(getByTestId("map-fs-carrier")).toBeTruthy();
      expect(getByTestId("map-fs-remaining")).toBeTruthy();
      expect(getByTestId("sheet")).toHaveTextContent("eta");
    });

    it("la llegada estimada mide lo que falta sobre la ruta, no en línea recta", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      let estimate: { kind: string; km?: number; target?: string } | undefined;
      const { getByTestId } = await render(
        <RouteMapCard
          testID="map"
          pickup={PICKUP}
          delivery={DELIVERY}
          live={LIVE}
          renderFullscreenSheet={(ctx) => {
            estimate = ctx.estimate;
            return null;
          }}
        />,
      );
      await fireEvent.press(getByTestId("map-frame-expand"));

      // La ruta del fixture (ejemplo de Google) mide cientos de km; en línea recta hasta la entrega hay ~1 km.
      expect(estimate).toEqual(expect.objectContaining({ kind: "eta", target: "delivery" }));
      expect(estimate?.km).toBeGreaterThan(100);
    });

    it("antes del retiro, el receptor ve la etapa y no la llegada al retiro", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      let estimate: { kind: string } | undefined;
      const { getByTestId } = await render(
        <RouteMapCard
          testID="map"
          pickup={PICKUP}
          delivery={DELIVERY}
          live={{ ...LIVE, phase: "pickup", viewer: "receiver" }}
          renderFullscreenSheet={(ctx) => {
            estimate = ctx.estimate;
            return null;
          }}
        />,
      );
      await fireEvent.press(getByTestId("map-frame-expand"));

      expect(estimate).toEqual(expect.objectContaining({ kind: "stage" }));
    });

    it("con openFullscreenOnMount abre solo y avisa", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const onOpened = jest.fn();
      const { getByTestId } = await render(
        <RouteMapCard
          testID="map"
          pickup={PICKUP}
          delivery={DELIVERY}
          live={LIVE}
          openFullscreenOnMount
          onOpenedFullscreenOnMount={onOpened}
          renderFullscreenSheet={() => <Text testID="sheet">sheet</Text>}
        />,
      );

      expect(getByTestId("sheet")).toBeTruthy();
      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it("AC7: el aviso del seguimiento va dentro del mapa, en la card y a pantalla completa", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const notice = { title: "Seguimiento en vivo", body: "Se activa al iniciar el recorrido.", tone: "neutral" as const };
      const { getByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} notice={notice} />,
      );

      expect(getByTestId("map-notice")).toHaveTextContent(/Seguimiento en vivo/);
      await fireEvent.press(getByTestId("map-frame-expand"));
      expect(getByTestId("map-fs-notice")).toHaveTextContent(/Se activa al iniciar el recorrido/);
    });
  });
});
