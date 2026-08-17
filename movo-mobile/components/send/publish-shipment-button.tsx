import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { hexToRgba } from "../../src/lib/color";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const IDLE_RADIUS = 10;
const CIRCLE_SIZE = 64;
const RING_R = 27;
const RING_CIRC = 2 * Math.PI * RING_R;
const SUCCESS_LIME = "#C6F24A";
const CHECK_CIRCLE = "#0A0A0B";

// Timings calcados 1:1 del diseño de referencia (Claude Design, proyecto "Animación
// loader botón envío") — el morph botón→círculo, el remate círculo→pantalla completa,
// el bounce del check y el fade del contenido de éxito usan exactamente sus mismas
// duraciones/easings.
const MORPH_TO_LOADING_MS = 420;
const MORPH_TO_EXPLODE_MS = 550;
const MORPH_TO_IDLE_MS = 350;
const SUCCESS_DELAY_MS = 80;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const BOUNCE = Easing.bezier(0.34, 1.56, 0.64, 1);

// El mock anima el anillo con un timer fijo de 1500ms porque no hay ningún request
// real detrás. Acá sí lo hay (crear el envío + subir fotos pendientes), así que el
// anillo avanza hasta ~92% en ese mismo tiempo de referencia (sensación idéntica) y
// recién completa el 100% cuando el submit real resuelve — nunca miente sobre el
// progreso si tarda más.
const RING_APPROACH_MS = 1500;
const RING_APPROACH_TARGET = 0.92;
const RING_SETTLE_MS = 220;
// Piso de tiempo visible para la fase de loading (feedback de UI post-implementación
// x4): en dev el submit real (crear envío, sin fotos que subir) suele resolver en
// <300ms, muy antes de que el barrido de `RING_APPROACH_MS` se note — el anillo
// arrancaba y cortaba a los tirones directo al remate. Si `onPublish()` resuelve
// antes de este piso, se espera el resto acá antes de asentar el anillo al 100% y
// explotar, para que la animación completa siempre se alcance a apreciar.
const MIN_LOADING_VISIBLE_MS = 1100;

type Phase = "idle" | "loading" | "exploding" | "success";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PublishShipmentButtonProps {
  label?: string;
  disabled?: boolean;
  /** Hace el trabajo real (crear envío + subir fotos pendientes) y devuelve el id del
   * envío creado. Si tira, el botón vuelve a idle y se delega el error al caller —
   * `SummaryStep` ya sabe mostrar el `ErrorBanner` existente contra ese error. */
  onPublish: () => Promise<string>;
  onPublishError: (error: unknown) => void;
  /** Se llama al tocar "Ver envío" en la pantalla de éxito. */
  onViewShipment: (shipmentId: string) => void;
  testID?: string;
}

/**
 * Botón "Publicar envío" del paso de resumen (MOVO-83, feedback de UI post-
 * implementación x3) — réplica del proyecto de Claude Design "Animación loader botón
 * envío" (`55f0c503-bf57-4110-b3bb-914abc035b78`): el botón se morphea a un círculo
 * con anillo de progreso, ese círculo "explota" a pantalla completa en lime, y ahí
 * adentro aparece la confirmación con un check animado. Todo corre en un `Modal`
 * transparente posicionado con las coordenadas reales del botón (`measureInWindow`)
 * — el mock vivía en un frame fijo de 390×844, acá el botón vive dentro de un scroll
 * y el "exploded" tiene que cubrir la pantalla real del dispositivo
 * (`useWindowDimensions`), no un tamaño hardcodeado.
 *
 * Colores adaptados al tema (a diferencia del mock, que es un solo screenshot claro):
 * el botón/círculo usa `fg1`/`bg` del tema (igual que la variante "dark" de
 * `PrimaryButton`) para no volverse invisible en dark mode — un botón fijo `#0A0A0B`
 * se perdería contra el fondo `#0A0A0B` del tema oscuro. La pantalla de éxito sí queda
 * fija en lime/negro como el mock: es opaca de punta a punta, no convive con el fondo
 * de la app en ningún momento.
 */
export function PublishShipmentButton({
  label = "Publicar envío",
  disabled,
  onPublish,
  onPublishError,
  onViewShipment,
  testID,
}: PublishShipmentButtonProps) {
  const colors = useThemeColors();
  const { width: winW, height: winH } = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  const idleRectRef = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  const [phase, setPhase] = useState<Phase>("idle");
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const loadingStartedAtRef = useRef(0);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const r = useSharedValue(IDLE_RADIUS);
  const bgProgress = useSharedValue(0);
  const scrimOpacity = useSharedValue(0);
  const labelOpacity = useSharedValue(1);
  const ringOpacity = useSharedValue(0);
  const ringProgress = useSharedValue(0);
  const successOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.4);

  const explodeSize = Math.hypot(winW, winH) * 1.15;

  function explode() {
    setPhase("exploding");
    x.value = withTiming(winW / 2 - explodeSize / 2, {
      duration: MORPH_TO_EXPLODE_MS,
      easing: EASE,
    });
    y.value = withTiming(winH / 2 - explodeSize / 2, {
      duration: MORPH_TO_EXPLODE_MS,
      easing: EASE,
    });
    w.value = withTiming(explodeSize, {
      duration: MORPH_TO_EXPLODE_MS,
      easing: EASE,
    });
    h.value = withTiming(explodeSize, {
      duration: MORPH_TO_EXPLODE_MS,
      easing: EASE,
    });
    r.value = withTiming(0, { duration: MORPH_TO_EXPLODE_MS, easing: EASE });
    bgProgress.value = withTiming(1, {
      duration: MORPH_TO_EXPLODE_MS,
      easing: EASE,
    });
    ringOpacity.value = withTiming(0, { duration: 140 });

    setTimeout(() => {
      setPhase("success");
      successOpacity.value = withDelay(
        SUCCESS_DELAY_MS,
        withTiming(1, { duration: 260 }),
      );
      checkScale.value = withDelay(
        SUCCESS_DELAY_MS,
        withTiming(1, { duration: 420, easing: BOUNCE }),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, MORPH_TO_EXPLODE_MS);
  }

  function settleAndExplode(id: string) {
    setShipmentId(id);
    cancelAnimation(ringProgress);
    ringProgress.value = withTiming(
      1,
      { duration: RING_SETTLE_MS, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(explode)();
      },
    );
  }

  function revertToIdle(error: unknown) {
    const idle = idleRectRef.current;
    ringOpacity.value = withTiming(0, { duration: 140 });
    scrimOpacity.value = withTiming(0, { duration: 250 });
    x.value = withTiming(idle.x, { duration: MORPH_TO_IDLE_MS, easing: EASE });
    y.value = withTiming(idle.y, { duration: MORPH_TO_IDLE_MS, easing: EASE });
    w.value = withTiming(idle.w, { duration: MORPH_TO_IDLE_MS, easing: EASE });
    h.value = withTiming(
      idle.h,
      { duration: MORPH_TO_IDLE_MS, easing: EASE },
      (finished) => {
        if (finished) runOnJS(setPhase)("idle");
      },
    );
    r.value = withTiming(IDLE_RADIUS, {
      duration: MORPH_TO_IDLE_MS,
      easing: EASE,
    });
    labelOpacity.value = withTiming(1, { duration: 200 });
    onPublishError(error);
  }

  function startPublish() {
    if (phase !== "idle" || disabled) return;
    anchorRef.current?.measureInWindow((mx, my, mw, mh) => {
      idleRectRef.current = { x: mx, y: my, w: mw, h: mh };
      x.value = mx;
      y.value = my;
      w.value = mw;
      h.value = mh;
      r.value = IDLE_RADIUS;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhase("loading");
      loadingStartedAtRef.current = Date.now();

      const cx = mx + mw / 2;
      const cy = my + mh / 2;
      x.value = withTiming(cx - CIRCLE_SIZE / 2, {
        duration: MORPH_TO_LOADING_MS,
        easing: EASE,
      });
      y.value = withTiming(cy - CIRCLE_SIZE / 2, {
        duration: MORPH_TO_LOADING_MS,
        easing: EASE,
      });
      w.value = withTiming(CIRCLE_SIZE, {
        duration: MORPH_TO_LOADING_MS,
        easing: EASE,
      });
      h.value = withTiming(CIRCLE_SIZE, {
        duration: MORPH_TO_LOADING_MS,
        easing: EASE,
      });
      r.value = withTiming(CIRCLE_SIZE / 2, {
        duration: MORPH_TO_LOADING_MS,
        easing: EASE,
      });
      labelOpacity.value = withTiming(0, { duration: 160 });
      ringOpacity.value = withTiming(1, { duration: 140 });
      scrimOpacity.value = withTiming(0.35, { duration: 250 });
      ringProgress.value = withTiming(RING_APPROACH_TARGET, {
        duration: RING_APPROACH_MS,
        easing: Easing.out(Easing.cubic),
      });

      onPublish()
        .then((id) => {
          const elapsed = Date.now() - loadingStartedAtRef.current;
          const remaining = MIN_LOADING_VISIBLE_MS - elapsed;
          if (remaining > 0) {
            setTimeout(() => settleAndExplode(id), remaining);
          } else {
            settleAndExplode(id);
          }
        })
        .catch((error) => {
          cancelAnimation(ringProgress);
          revertToIdle(error);
        });
    });
  }

  const shapeStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    borderRadius: r.value,
    backgroundColor: interpolateColor(
      bgProgress.value,
      [0, 1],
      [colors.fg1, SUCCESS_LIME],
    ),
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#000000",
    opacity: scrimOpacity.value,
  }));

  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value }));
  const successStyle = useAnimatedStyle(() => ({
    opacity: successOpacity.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const ringAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRC * (1 - ringProgress.value),
  }));

  return (
    <View testID={testID} ref={anchorRef} collapsable={false}>
      <Pressable
        onPress={startPublish}
        disabled={disabled || phase !== "idle"}
        style={{
          opacity: phase === "idle" ? 1 : 0,
          width: "100%",
          borderRadius: IDLE_RADIUS,
          backgroundColor: colors.fg1,
          paddingVertical: 15,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: colors.bg,
            fontSize: 16,
            fontWeight: "600",
            letterSpacing: -0.16,
          }}
        >
          {label}
        </Text>
      </Pressable>

      <Modal
        visible={phase !== "idle"}
        transparent
        animationType="none"
        onRequestClose={() => {}}
      >
        <View style={{ flex: 1 }}>
          <Animated.View style={scrimStyle} pointerEvents="none" />
          <Animated.View style={shapeStyle}>
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <Animated.View style={[{ position: "absolute" }, labelStyle]}>
                <Text
                  style={{
                    color: colors.bg,
                    fontSize: 16,
                    fontWeight: "600",
                    letterSpacing: -0.16,
                  }}
                >
                  {label}
                </Text>
              </Animated.View>

              <Animated.View style={[{ position: "absolute" }, ringStyle]}>
                <Svg
                  width={CIRCLE_SIZE}
                  height={CIRCLE_SIZE}
                  viewBox="0 0 64 64"
                >
                  <Circle
                    cx={32}
                    cy={32}
                    r={RING_R}
                    fill="none"
                    stroke={hexToRgba(colors.bg, 0.25)}
                    strokeWidth={4}
                  />
                  <AnimatedCircle
                    cx={32}
                    cy={32}
                    r={RING_R}
                    fill="none"
                    stroke={SUCCESS_LIME}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRC}
                    animatedProps={ringAnimatedProps}
                    transform="rotate(-90 32 32)"
                  />
                </Svg>
              </Animated.View>

              <Animated.View
                style={[
                  {
                    position: "absolute",
                    width: winW,
                    alignItems: "center",
                    gap: 20,
                    paddingHorizontal: 40,
                  },
                  successStyle,
                ]}
              >
                <Animated.View
                  style={[
                    {
                      width: 72,
                      height: 72,
                      borderRadius: 999,
                      backgroundColor: CHECK_CIRCLE,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                    checkStyle,
                  ]}
                >
                  <Svg width={34} height={34} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M4 12.5L9.5 18L20 6"
                      stroke={SUCCESS_LIME}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </Animated.View>
                <View style={{ alignItems: "center" }}>
                  <Text
                    style={{
                      color: "#0A0A0B",
                      fontSize: 22,
                      fontWeight: "600",
                      letterSpacing: -0.22,
                      marginBottom: 8,
                    }}
                  >
                    Envío publicado
                  </Text>
                  <Text
                    style={{
                      color: "#3A3A40",
                      fontSize: 14,
                      lineHeight: 21,
                      textAlign: "center",
                    }}
                  >
                    Tu envío ya fue publicado a la comunidad de Movers. Ahora
                    vas a empezar a recibir ofertas y podés elegir la que más
                    te convenga.
                  </Text>
                </View>
                <Pressable
                  testID={testID ? `${testID}-view-shipment` : undefined}
                  onPress={() => shipmentId && onViewShipment(shipmentId)}
                  style={{
                    marginTop: 8,
                    paddingHorizontal: 20,
                    paddingVertical: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: "rgba(10,10,11,0.25)",
                  }}
                >
                  <Text
                    style={{
                      color: "#0A0A0B",
                      fontSize: 13,
                      fontWeight: "500",
                    }}
                  >
                    Ver envío
                  </Text>
                </Pressable>
              </Animated.View>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}
