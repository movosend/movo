import { useEffect, useRef, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

export interface AnimatedSplashProps {
  colorScheme: "light" | "dark";
  /** `false` mientras la app sigue resolviendo boot (fuentes, override de API,
   * sesión, y a dónde navegar) -- ver `useBootStore`/`app/_layout.tsx`. El splash
   * respira mientras esto es `false` y recién ahí puede arrancar su salida. */
  ready: boolean;
  /** Se llama una única vez que termina la animación de salida -- el caller
   * desmonta este componente ahí, no antes (mientras tanto sigue tapando la app). */
  onFinished: () => void;
  testID?: string;
}

/**
 * MOVO-247, opción "1A · Expansión" del prototipo de Claude Design (proyecto
 * "Launch screen con animación de logo"). El isotipo (mismos 5 radios
 * concéntricos que `MovoIsotype`, ver `uploads/logo.svg` del proyecto) respira
 * en grises mientras la app carga; al terminar, los anillos se encienden en
 * lime de adentro hacia afuera y el conjunto se expande desde el centro hasta
 * cubrir la pantalla, revelando la app detrás.
 *
 * Reproduce la INTENCIÓN del prototipo (`.dc.html`, JS/CSS del navegador) con
 * primitivas de Reanimated ya probadas en este repo, no una traducción literal
 * del `clip-path` que arma el mock -- react-native-svg no lo aplica de forma
 * confiable (ver el comentario de `app/(auth)/kyc.tsx`), así que en vez de
 * recortar la app detrás con un círculo creciente, cada anillo apila 3 discos
 * planos (base gris, resalte de respiración, lime de salida) que se
 * cross-fadean entre sí -- matemáticamente equivalente al `lerp` de color del
 * mock (alpha-blend de un color sólido sobre otro), y el "revelado" final es
 * un fundido a opacidad 0 de TODO el overlay una vez que el conjunto ya
 * terminó de expandirse, no un clip-path real sobre el contenido de abajo
 * (que ya está montado detrás, sin ninguna animación de navegación de por
 * medio -- así se evita el "push" que este ticket vino a sacar).
 *
 * Nota de consistencia de color (AC5 del ticket): el prototipo ya trae DOS
 * variantes (light/dark) con paletas propias -- no hay ninguna excepción real
 * al manual de marca que resolver, el fondo sigue el theme del sistema igual
 * que el resto de la app (MOVO-73, `darkMode:"class"` de NativeWind).
 */
export function AnimatedSplash({ colorScheme, ready, onFinished, testID }: AnimatedSplashProps) {
  const pal = PALETTES[colorScheme];
  const { width: screenW, height: screenH } = Dimensions.get("window");
  // Centro un poco por encima de la mitad de pantalla (mismo criterio que el
  // `cy=400/844≈0.47` del mock) -- deja más aire para el wordmark debajo sin
  // invadir el área segura inferior.
  const cx = screenW / 2;
  const cy = screenH * 0.46;
  // Proporción del mock (R=76 sobre un frame de 390 de ancho ≈ 19.5% del ancho).
  const R = screenW * 0.195;

  const [exiting, setExiting] = useState(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Respiración: un valor de 0↔1 por anillo, desfasado de adentro hacia afuera
  // (mismo sentido que el encendido a lime de la salida) para que el pulso se
  // sienta como que "nace" en el centro del isotipo.
  const markOpacity = useSharedValue(0);
  const wordOpacity = useSharedValue(0);
  const wordTranslateY = useSharedValue(0);
  const breatheScale = useSharedValue(1);
  const exitScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
  // 4 valores explícitos por array (no `RING_INDEXES.map(() => useSharedValue(0))`):
  // llamar a un hook dentro de un `.map()` viola las reglas de hooks aunque la
  // cantidad de iteraciones sea fija -- desenrollado a mano, los arrays se arman
  // recién después de tener los 4 shared values ya creados.
  const breatheHighlight0 = useSharedValue(0);
  const breatheHighlight1 = useSharedValue(0);
  const breatheHighlight2 = useSharedValue(0);
  const breatheHighlight3 = useSharedValue(0);
  const breatheHighlight = [breatheHighlight0, breatheHighlight1, breatheHighlight2, breatheHighlight3];
  const limeReveal0 = useSharedValue(0);
  const limeReveal1 = useSharedValue(0);
  const limeReveal2 = useSharedValue(0);
  const limeReveal3 = useSharedValue(0);
  const limeReveal = [limeReveal0, limeReveal1, limeReveal2, limeReveal3];

  useEffect(() => {
    markOpacity.value = withTiming(1, { duration: MARK_FADE_IN_MS, easing: EASE_OUT });
    wordOpacity.value = withTiming(1, { duration: WORD_FADE_IN_MS, easing: EASE_OUT });
    breatheScale.value = withRepeat(
      withSequence(
        withTiming(BREATHE_SCALE_PEAK, { duration: BREATHE_PERIOD_MS / 2, easing: EASE_IN_OUT }),
        withTiming(1, { duration: BREATHE_PERIOD_MS / 2, easing: EASE_IN_OUT }),
      ),
      -1,
      false,
    );
    RING_INDEXES.forEach((i) => {
      const delay = (RING_INDEXES.length - 1 - i) * RING_STAGGER_MS;
      breatheHighlight[i].value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(BREATHE_HIGHLIGHT_PEAK, { duration: BREATHE_PERIOD_MS / 2, easing: EASE_IN_OUT }),
            withTiming(0, { duration: BREATHE_PERIOD_MS / 2, easing: EASE_IN_OUT }),
          ),
          -1,
          false,
        ),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pedido explícito del usuario: la animación se ve como mínimo ~3s (para
  // poder apreciarla) aunque el boot real termine antes -- pero sin cortar
  // nunca a mitad de un ciclo de respiración (mismo criterio que el prototipo,
  // "la salida siempre espera a que el loop termine su ciclo"). Se logra
  // redondeando el piso de 3s hacia arriba al próximo múltiplo del período de
  // respiración, y de ahí en más reintentando en cada límite de ciclo hasta
  // que `ready` sea `true`.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = (delay: number) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        if (readyRef.current) {
          setExiting(true);
        } else {
          check(BREATHE_PERIOD_MS);
        }
      }, delay);
    };
    check(EXIT_EARLIEST_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Failsafe (feedback de review, Pedro): `ready` depende de `restoreSession`/
  // `loadApiOverride` (`app/_layout.tsx`) -- ambos tienen catch/finally propio,
  // pero ante un cuelgue no previsto a nivel runtime (nunca resuelven ni
  // rechazan) el loop de arriba seguiría esperando para siempre y el usuario
  // quedaría atrapado en el splash. Este timer fuerza la salida a los
  // `HARD_TIMEOUT_MS` sin importar `ready` ni el límite de ciclo de
  // respiración -- a diferencia del camino feliz de arriba, acá sí está bien
  // cortar a mitad de un pulso: es una red de seguridad, no una animación.
  // `setExiting(true)` es idempotente (el efecto de salida solo corre una vez,
  // gateado por `exiting`), así que no interfiere si la salida normal ya
  // arrancó antes.
  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), HARD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    // Frena la respiración en loop (si no, sigue corriendo por debajo del
    // scale de salida y agrega un ripple de ±3% durante toda la expansión).
    breatheScale.value = withTiming(1, { duration: 150, easing: EASE_OUT });
    wordOpacity.value = withTiming(0, { duration: WORD_EXIT_MS, easing: EASE_OUT });
    wordTranslateY.value = withTiming(WORD_EXIT_TRANSLATE_Y, { duration: WORD_EXIT_MS, easing: EASE_OUT });
    RING_INDEXES.forEach((i) => {
      const delay = (RING_INDEXES.length - 1 - i) * RING_STAGGER_MS;
      limeReveal[i].value = withDelay(delay, withTiming(1, { duration: LIME_FADE_MS, easing: EASE_OUT }));
    });
    exitScale.value = withDelay(
      SCALE_EXIT_DELAY_MS,
      withTiming(revealScale(cx, cy, screenW, screenH, R), {
        duration: SCALE_EXIT_DURATION_MS,
        easing: EASE_IN_OUT,
      }),
    );
    overlayOpacity.value = withDelay(
      OVERLAY_FADE_DELAY_MS,
      withTiming(0, { duration: OVERLAY_FADE_MS, easing: EASE_OUT }, (finished) => {
        if (finished) runOnJS(onFinished)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateY: wordTranslateY.value }],
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: breatheScale.value * exitScale.value }],
  }));

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: pal.bg }, overlayStyle]}
    >
      <Animated.View
        style={[
          { position: "absolute", left: cx, top: cy, width: 0, height: 0 },
          markStyle,
        ]}
      >
        {RING_INDEXES.map((i) => (
          <Ring key={i} radius={RAD[i] * R} baseColor={pal.grey[i]} fgColor={pal.fg} limeColor={pal.lime[i]} breathe={breatheHighlight[i]} lime={limeReveal[i]} />
        ))}
        <Hole radius={RAD[4] * R} color={pal.bg} />
      </Animated.View>
      <Animated.View
        style={[{ position: "absolute", left: 0, right: 0, top: cy + R + WORD_GAP, alignItems: "center" }, wordStyle]}
      >
        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 34, letterSpacing: -1.4, color: pal.fg }}>
          movo
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

function Ring({
  radius,
  baseColor,
  fgColor,
  limeColor,
  breathe,
  lime,
}: {
  radius: number;
  baseColor: string;
  fgColor: string;
  limeColor: string;
  breathe: SharedValue<number>;
  lime: SharedValue<number>;
}) {
  const size = radius * 2;
  const geom = { position: "absolute" as const, left: -radius, top: -radius, width: size, height: size, borderRadius: radius };
  const breatheStyle = useAnimatedStyle(() => ({ opacity: breathe.value }));
  const limeStyle = useAnimatedStyle(() => ({ opacity: lime.value }));
  return (
    <View style={geom}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: baseColor }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: fgColor }, breatheStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: limeColor }, limeStyle]} />
    </View>
  );
}

function Hole({ radius, color }: { radius: number; color: string }) {
  const size = radius * 2;
  return (
    <View
      style={{
        position: "absolute",
        left: -radius,
        top: -radius,
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: color,
      }}
    />
  );
}

/** Radios relativos del isotipo (mismo `viewBox` de 500 que `MovoIsotype`,
 * normalizado a la unidad -- 4 bandas + el hueco central). */
const RAD = [1, 0.9375, 0.8625, 0.7743, 0.6813];
const RING_INDEXES = [0, 1, 2, 3] as const;
const WORD_GAP = 28;

const BREATHE_PERIOD_MS = 1600;
// Pedido explícito del usuario: la respiración pasaba casi desapercibida con los
// valores del mock tal cual (3% de escala, 35% de resalte) -- se nota mucho más
// sutil en un dispositivo real chico que en el frame gigante del prototipo en el
// navegador. Subidos a un rango bien perceptible sin romper el look "sereno" del
// loop (nunca llega a la escala/opacidad de la salida en sí).
const BREATHE_SCALE_PEAK = 1.09;
const BREATHE_HIGHLIGHT_PEAK = 0.85;
// Desfasado como fracción real del período (no unos pocos ms) -- así la ola se ve
// viajar entre anillos en vez de respirar los 4 casi en simultáneo.
const RING_STAGGER_MS = Math.round(BREATHE_PERIOD_MS * 0.09);
/** Pedido explícito del usuario: mínimo ~3s de animación visible, aunque el
 * boot real termine antes -- redondeado hacia arriba al próximo límite de
 * ciclo de respiración para no cortar a mitad de un pulso. */
const MIN_DISPLAY_MS = 3000;
const EXIT_EARLIEST_MS = Math.ceil(MIN_DISPLAY_MS / BREATHE_PERIOD_MS) * BREATHE_PERIOD_MS;
/** Failsafe: tiempo máximo absoluto que el splash puede quedar tapando la app
 * aunque `ready` nunca llegue a `true` (ver el comentario del efecto). */
const HARD_TIMEOUT_MS = 12000;

const MARK_FADE_IN_MS = 300;
const WORD_FADE_IN_MS = 350;
const WORD_EXIT_MS = 350;
const WORD_EXIT_TRANSLATE_Y = 20;
const LIME_FADE_MS = 320;
const SCALE_EXIT_DELAY_MS = 420;
const SCALE_EXIT_DURATION_MS = 820;
const OVERLAY_FADE_DELAY_MS = 1100;
const OVERLAY_FADE_MS = 220;

const EASE_OUT = Easing.out(Easing.cubic);
const EASE_IN_OUT = Easing.inOut(Easing.cubic);

/** Escala final que garantiza que el isotipo cubra toda la pantalla desde su
 * centro (distancia a la esquina más lejana + margen de seguridad), mismo
 * espíritu que el `sc` del mock pero calculado contra el tamaño real del
 * dispositivo en vez de un frame de mock fijo (390×844). */
function revealScale(cx: number, cy: number, screenW: number, screenH: number, R: number): number {
  const farX = Math.max(cx, screenW - cx);
  const farY = Math.max(cy, screenH - cy);
  const maxDistance = Math.hypot(farX, farY);
  return (maxDistance / R) * 1.15;
}

const PALETTES = {
  light: {
    bg: "#FFFFFF",
    fg: "#0A0A0B",
    grey: ["#DADADA", "#B6B6B6", "#717172", "#222223"],
    lime: ["#E3FA98", "#D6F771", "#C6F24A", "#9FC72E"],
  },
  dark: {
    bg: "#0A0A0B",
    fg: "#FFFFFF",
    grey: ["#6A6969", "#A4A3A4", "#D6D6D6", "#FFFFFF"],
    lime: ["#647A24", "#97B537", "#B3DA43", "#C6F24A"],
  },
} as const;
