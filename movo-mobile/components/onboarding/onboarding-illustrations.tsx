import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Mask, Path, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Package, Route, Shield } from "lucide-react-native";

/**
 * Ilustraciones del carrusel de onboarding (MOVO-249) — reconstrucción 1:1 del
 * prototipo de Claude Design (`Onboarding.dc.html`), no una interpretación libre:
 * mismas coordenadas, paths SVG, colores, fotos (randomuser.me, igual que el
 * prototipo) y curvas de animación, traducidas a `react-native-svg` +
 * `react-native-reanimated` porque RN no tiene `<canvas>` ni CSS `@keyframes`.
 *
 * Todo se diseña a un ancho nominal de 390 (el frame del prototipo) y se ancla
 * centrado sin reescalar — la diferencia real entre un iPhone (390-393pt) y un
 * Android chico (360dp) es de unos pocos px por lado en elementos puramente
 * decorativos (grilla, anillos), imperceptible.
 */

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const EASE_OUT = Easing.out(Easing.ease);
const EASE_IN_OUT = Easing.inOut(Easing.ease);

function avatarUri(path: string): string {
  return `https://randomuser.me/api/portraits/${path}.jpg`;
}

/** `mvFloat`: translateY oscilando ±7px, loop infinito. */
function useFloatY(durationMs: number, delayMs: number) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withRepeat(withTiming(1, { duration: durationMs / 2, easing: EASE_IN_OUT }), -1, true),
    );
    return () => cancelAnimation(progress);
  }, [durationMs, delayMs, progress]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: -7 * progress.value }] }));
}

/** `mvPop`: entrada con scale 0.5→1.04→1 + fade in. */
function usePopIn(delayMs: number) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withSequence(
        withTiming(1.04, { duration: 350, easing: EASE_OUT }),
        withTiming(1, { duration: 150, easing: EASE_OUT }),
      ),
    );
    return () => cancelAnimation(progress);
  }, [delayMs, progress]);
  return useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value / 0.4),
    transform: [{ scale: Math.max(0.5, progress.value) }],
  }));
}

/** `mvRadar`: anillo que crece desde el centro y se desvanece, loop infinito. */
function useRadarRing(durationMs: number, delayMs: number) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delayMs, withRepeat(withTiming(1, { duration: durationMs, easing: EASE_OUT }), -1, false));
    return () => cancelAnimation(progress);
  }, [durationMs, delayMs, progress]);
  return useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - progress.value),
    transform: [{ scale: 0.3 + progress.value * 0.7 }],
  }));
}

/** `mvPulse`: halo que se expande y se desvanece detrás de un punto — sustituye la
 * animación de `box-shadow` del prototipo (no animable de forma fiable en RN). */
function usePulseHalo() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1400, easing: EASE_OUT }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress]);
  return useAnimatedStyle(() => ({
    opacity: 0.7 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.8 }],
  }));
}

/** `mvDash`: `strokeDashoffset` corriendo en loop — el "hormigueo" de las líneas
 * punteadas de ruta. */
function useDashOffset(distance: number, durationMs: number, reverse = false) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [durationMs, progress]);
  return useAnimatedProps(() => ({
    strokeDashoffset: (reverse ? 1 : -1) * progress.value * distance,
  }));
}

function Avatar({ uri, size, ringColor = "#fff" }: { uri: string; size: number; ringColor?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: ringColor,
        backgroundColor: "#E6E6EA",
        overflow: "hidden",
        shadowColor: "#0A0A0B",
        shadowOpacity: 0.14,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
    </View>
  );
}

/* ───────────────────────── Paso 0 — "La red" ───────────────────────── */

const NETWORK_AVATARS: Array<{ x: number; y: number; s: number; u: string; delay: number }> = [
  { x: 118, y: 112, s: 70, u: "women/44", delay: 100 },
  { x: 226, y: 86, s: 50, u: "men/32", delay: 170 },
  { x: 302, y: 150, s: 62, u: "women/65", delay: 240 },
  { x: 186, y: 188, s: 86, u: "men/46", delay: 310 },
  { x: 82, y: 220, s: 54, u: "men/75", delay: 380 },
  { x: 292, y: 258, s: 56, u: "women/12", delay: 450 },
  { x: 146, y: 298, s: 68, u: "women/90", delay: 520 },
  { x: 236, y: 322, s: 44, u: "men/22", delay: 590 },
];

const NETWORK_DASH_PATHS = [
  { d: "M 118 112 C 150 36, 250 206, 302 150", width: 2, dash: "2 7", duration: 5000 },
  { d: "M 82 220 C 140 304, 220 186, 292 258", width: 2, dash: "2 7", duration: 6000 },
  { d: "M 186 188 C 256 226, 184 284, 236 322", width: 2, dash: "2 7", duration: 5500 },
  { d: "M 118 112 C 36 128, 136 196, 82 220", width: 1.5, dash: "2 7", duration: 5000 },
  { d: "M 146 298 C 168 366, 224 276, 236 322", width: 1.5, dash: "1 6", duration: 5000 },
  { d: "M 302 150 C 364 192, 246 218, 292 258", width: 1.5, dash: "2 7", duration: 5000 },
];

function NetworkDashPath({ d, width, dash, duration }: { d: string; width: number; dash: string; duration: number }) {
  const animatedProps = useDashOffset(36, duration);
  return (
    <AnimatedPath
      d={d}
      stroke="#8A8A93"
      strokeWidth={width}
      strokeDasharray={dash}
      strokeLinecap="round"
      fill="none"
      animatedProps={animatedProps}
    />
  );
}

function FloatChip({ x, y, delay, duration = 3600, children }: { x: number; y: number; delay: number; duration?: number; children: React.ReactNode }) {
  const pop = usePopIn(500 + delay * 0.3);
  const float = useFloatY(duration, delay);
  return (
    <Animated.View style={[{ position: "absolute", left: x, top: y, zIndex: 6 }, pop]}>
      <Animated.View style={float}>{children}</Animated.View>
    </Animated.View>
  );
}

function NetworkRadarRing({ index }: { index: number }) {
  const ring = useRadarRing(3600, index * 1200);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", left: 195 - 190, top: 208 - 190, width: 380, height: 380, borderRadius: 190, borderWidth: 1.5, borderColor: "rgba(10,10,11,0.1)" },
        ring,
      ]}
    />
  );
}

function NetworkAvatar({ a, index }: { a: (typeof NETWORK_AVATARS)[number]; index: number }) {
  const pop = usePopIn(100 + index * 70);
  const float = useFloatY(3400 + (index % 3) * 700, index * 300);
  return (
    <Animated.View style={[{ position: "absolute", left: a.x - a.s / 2, top: a.y - a.s / 2, width: a.s, height: a.s, zIndex: 3 }, pop]}>
      <Animated.View style={float}>
        <Avatar uri={avatarUri(a.u)} size={a.s} />
      </Animated.View>
    </Animated.View>
  );
}

const NETWORK_W = 390;
const NETWORK_H = 400;

/** Cuadrícula de 24px que se desvanece hacia los bordes (`linear-gradient` cruzados
 * + `mask-image` radial en el prototipo). En RN va como un único `<Path>` recortado
 * por un `<Mask>`, mismo recurso que `TrustDotBackdrop`. */
const NETWORK_GRID_D = (() => {
  let d = "";
  for (let x = 0; x < NETWORK_W; x += 24) d += `M${x} 0V${NETWORK_H}`;
  for (let y = 0; y < NETWORK_H; y += 24) d += `M0 ${y}H${NETWORK_W}`;
  return d;
})();

function NetworkGridBackdrop() {
  return (
    <Svg width={NETWORK_W} height={NETWORK_H} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
      <Defs>
        <RadialGradient id="mvNetFade" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#fff" stopOpacity={1} />
          <Stop offset="0.2" stopColor="#fff" stopOpacity={1} />
          <Stop offset="1" stopColor="#fff" stopOpacity={0} />
        </RadialGradient>
        <Mask id="mvNetMask">
          <Rect x={0} y={0} width={NETWORK_W} height={NETWORK_H} fill="url(#mvNetFade)" />
        </Mask>
      </Defs>
      <Path d={NETWORK_GRID_D} stroke="rgba(10,10,11,0.05)" strokeWidth={1} fill="none" mask="url(#mvNetMask)" />
    </Svg>
  );
}

export function NetworkIllustration() {
  return (
    <View style={{ width: NETWORK_W, height: NETWORK_H, alignSelf: "center" }}>
      <NetworkGridBackdrop />
      {[0, 1, 2].map((i) => (
        <NetworkRadarRing key={i} index={i} />
      ))}
      <Svg width={390} height={400} style={{ position: "absolute" }}>
        {NETWORK_DASH_PATHS.map((p, i) => (
          <NetworkDashPath key={i} {...p} />
        ))}
      </Svg>

      {NETWORK_AVATARS.map((a, i) => (
        <NetworkAvatar key={a.u} a={a} index={i} />
      ))}

      <FloatChip x={80 - 16} y={76 - 16} delay={0}>
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: "#0A0A0B", alignItems: "center", justifyContent: "center" }}>
          <Package size={16} color="#fff" strokeWidth={2} />
        </View>
      </FloatChip>
      <FloatChip x={222 - 8} y={152 - 8} delay={100} duration={2000}>
        <PulsingDot />
      </FloatChip>
      <FloatChip x={334 - 16} y={288 - 16} delay={200}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#0A0A0B", alignItems: "center", justifyContent: "center" }}>
          <Route size={16} color="#fff" strokeWidth={2} />
        </View>
      </FloatChip>
      <FloatChip x={102 - 14} y={334 - 14} delay={300}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(10,10,11,0.08)", alignItems: "center", justifyContent: "center" }}>
          <Shield size={15} color="#2BB673" strokeWidth={2} />
        </View>
      </FloatChip>
      <FloatChip x={258 - 24} y={58 - 12} delay={400}>
        <View style={{ height: 24, paddingHorizontal: 9, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(10,10,11,0.08)", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 11, fontWeight: "500", color: "#3A3A40" }}>3 km</Text>
        </View>
      </FloatChip>
    </View>
  );
}

function PulsingDot() {
  const halo = usePulseHalo();
  return (
    <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(198,242,74,0.8)" }, halo]} />
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#C6F24A", borderWidth: 3, borderColor: "#fff" }} />
    </View>
  );
}

/* ───────────────────────── Paso 1 — "Confianza" ───────────────────────── */

const TRUST_ROUTE_D = "M 30 100 C 90 100, 90 40, 160 50 S 250 92, 282 32";
const TRUST_CARRIER_AVATAR = "men/32";
const TRUST_W = 390;
const TRUST_H = 400;
const TRUST_MAP_W = 310;
const TRUST_MAP_H = 130;

/** Sombra compartida de las dos tarjetas: el prototipo apila dos (`0 24px 60px`
 * + `0 6px 16px`), RN solo admite una por vista — se aproxima con la grande. */
const TRUST_CARD_SHADOW = {
  shadowColor: "#0A0A0B",
  shadowOpacity: 0.14,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 16 },
  elevation: 10,
} as const;

/** Cuadrícula de 24px del mapa (`linear-gradient` cruzados en CSS) como un único
 * `d`, para no instanciar un `<Line>` por cada raya. */
const TRUST_MAP_GRID_D = (() => {
  let d = "";
  for (let x = 24; x < TRUST_MAP_W; x += 24) d += `M${x} 0V${TRUST_MAP_H}`;
  for (let y = 24; y < TRUST_MAP_H; y += 24) d += `M0 ${y}H${TRUST_MAP_W}`;
  return d;
})();

/** `mvFadeUp`: entra desde abajo con fade. */
function useFadeUp(delayMs: number, distance = 14) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delayMs, withTiming(1, { duration: 700, easing: EASE_OUT }));
    return () => cancelAnimation(progress);
  }, [delayMs, progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: distance * (1 - progress.value) }],
  }));
}

/** `mvSlideL`: entra desde la izquierda con fade. */
function useSlideLeft(delayMs: number, distance = 28) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delayMs, withTiming(1, { duration: 700, easing: EASE_OUT }));
    return () => cancelAnimation(progress);
  }, [delayMs, progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: -distance * (1 - progress.value) }],
  }));
}

/** Fondo de puntitos (grilla de 8px) que se desvanece hacia los bordes — el
 * `background-image` + `mask-image` del prototipo, acá como `<Pattern>` recortado
 * por un `<Mask>` radial. */
function TrustDotBackdrop() {
  return (
    <Svg width={TRUST_W} height={TRUST_H} style={{ position: "absolute", left: 0, top: 0 }} opacity={0.6} pointerEvents="none">
      <Defs>
        <Pattern id="mvTrustDots" x={0} y={0} width={8} height={8} patternUnits="userSpaceOnUse">
          <Circle cx={4} cy={4} r={1} fill="rgba(10,10,11,0.14)" />
        </Pattern>
        <RadialGradient id="mvTrustFade" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#fff" stopOpacity={1} />
          <Stop offset="0.1" stopColor="#fff" stopOpacity={1} />
          <Stop offset="1" stopColor="#fff" stopOpacity={0} />
        </RadialGradient>
        <Mask id="mvTrustMask">
          <Rect x={0} y={0} width={TRUST_W} height={TRUST_H} fill="url(#mvTrustFade)" />
        </Mask>
      </Defs>
      <Rect x={0} y={0} width={TRUST_W} height={TRUST_H} fill="url(#mvTrustDots)" mask="url(#mvTrustMask)" />
    </Svg>
  );
}

/** Puntito de "EN VIVO": 6px lime con el halo de `mvPulse` (el `box-shadow`
 * animado del prototipo, que RN no puede animar). Distinto del `PulsingDot` de
 * 16px con borde blanco que usa la ilustración de la red. */
function LiveDot() {
  const halo = usePulseHalo();
  return (
    <View style={{ width: 6, height: 6, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(198,242,74,0.8)" }, halo]} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#C6F24A" }} />
    </View>
  );
}

export function TrustIllustration() {
  // `mvDash`: el punteado corre 36px (largo de un ciclo `10 8` ×2) en 1s.
  const routeAnimatedProps = useDashOffset(36, 1000);
  const dotProgress = useSharedValue(0);
  useEffect(() => {
    dotProgress.value = withDelay(
      600,
      withRepeat(withSequence(withTiming(1, { duration: 5000, easing: EASE_IN_OUT }), withTiming(0, { duration: 5000, easing: EASE_IN_OUT })), -1, false),
    );
    return () => cancelAnimation(dotProgress);
  }, [dotProgress]);
  // Punto viajero a lo largo de una curva cúbica compuesta — se interpola en JS
  // (path plano, sin `getPointAtLength` disponible en RN) contra 40 muestras
  // precalculadas de la curva.
  const dotStyle = useAnimatedStyle(() => {
    const idx = dotProgress.value * (TRUST_ROUTE_SAMPLES.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(TRUST_ROUTE_SAMPLES.length - 1, i0 + 1);
    const t = idx - i0;
    const p0 = TRUST_ROUTE_SAMPLES[i0];
    const p1 = TRUST_ROUTE_SAMPLES[i1];
    return {
      transform: [{ translateX: p0.x + (p1.x - p0.x) * t - 13 }, { translateY: p0.y + (p1.y - p0.y) * t - 13 }],
    };
  });

  const cardFadeUp = useFadeUp(100);
  const cardFloat = useFloatY(5000, 1000);
  const profileSlide = useSlideLeft(450);
  const profileFloat = useFloatY(4400, 1200);
  const badgePop = usePopIn(800);
  const badgeFloat = useFloatY(3800, 400);

  return (
    <View style={{ width: TRUST_W, height: TRUST_H, alignSelf: "center" }}>
      <TrustDotBackdrop />

      {/* Tarjeta del mapa en vivo. */}
      <Animated.View style={[{ position: "absolute", left: 40, top: 70, width: TRUST_MAP_W }, cardFadeUp]}>
        <Animated.View
          style={[
            { borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(10,10,11,0.08)", overflow: "hidden", ...TRUST_CARD_SHADOW },
            cardFloat,
          ]}
        >
          <View style={{ height: TRUST_MAP_H, backgroundColor: "#F8F8FA" }}>
            <Svg width={TRUST_MAP_W} height={TRUST_MAP_H} style={{ position: "absolute", left: 0, top: 0 }}>
              <Path d={TRUST_MAP_GRID_D} stroke="rgba(10,10,11,0.05)" strokeWidth={1} fill="none" />
              <Path d="M -10 72 L 320 18" stroke="#fff" strokeWidth={12} />
              <Path d="M 118 -10 L 190 140" stroke="#fff" strokeWidth={12} />
              <Path d="M -10 118 L 320 110" stroke="#fff" strokeWidth={10} />
              <Path d={TRUST_ROUTE_D} fill="none" stroke="#DEDEE3" strokeWidth={5} strokeLinecap="round" />
              <AnimatedPath d={TRUST_ROUTE_D} fill="none" stroke="#0A0A0B" strokeWidth={3} strokeDasharray="10 8" strokeLinecap="round" animatedProps={routeAnimatedProps} />
              <Circle cx={30} cy={100} r={6} fill="#0A0A0B" stroke="#fff" strokeWidth={3} />
              <Circle cx={282} cy={32} r={8} fill="#0A0A0B" stroke="#fff" strokeWidth={3} />
            </Svg>
            {/* El `box-shadow` doble del punto (halo sólido + glow difuso) se separa
                en un anillo propio + la sombra nativa, que RN sí puede difuminar. */}
            <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: 26, height: 26, alignItems: "center", justifyContent: "center" }, dotStyle]}>
              <View style={{ position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(198,242,74,0.3)" }} />
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: "#C6F24A",
                  borderWidth: 3,
                  borderColor: "#0A0A0B",
                  shadowColor: "#C6F24A",
                  shadowOpacity: 0.6,
                  shadowRadius: 9,
                  shadowOffset: { width: 0, height: 0 },
                }}
              />
            </Animated.View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 22, paddingHorizontal: 8, borderRadius: 999, backgroundColor: "#0A0A0B" }}>
              <LiveDot />
              <Text style={{ fontSize: 10, fontWeight: "600", color: "#fff", letterSpacing: 0.8 }}>EN VIVO</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: "#0A0A0B" }}>Palermo a Caballito</Text>
            <Text style={{ fontSize: 12, fontWeight: "500", color: "#5A5A62" }}>12 min</Text>
          </View>
        </Animated.View>
      </Animated.View>

      {/* Tarjeta del transportista. */}
      <Animated.View style={[{ position: "absolute", left: 20, top: 250, width: 262 }, profileSlide]}>
        <Animated.View
          style={[
            { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(10,10,11,0.08)", ...TRUST_CARD_SHADOW },
            profileFloat,
          ]}
        >
          {/* Anillo de 2px y sin sombra — distinto del `Avatar` compartido (3px + sombra). */}
          <Image
            source={{ uri: avatarUri(TRUST_CARRIER_AVATAR) }}
            style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: "#C6F24A", backgroundColor: "#E6E6EA" }}
            resizeMode="cover"
          />
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#0A0A0B" }}>Tomás Olmos</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Shield size={14} color="#2BB673" strokeWidth={2} />
              <Text style={{ fontSize: 12, fontWeight: "500", color: "#2BB673" }}>Identidad verificada</Text>
            </View>
            <Text style={{ fontSize: 11, fontWeight: "500", color: "#5A5A62" }}>4,9 · 128 envíos</Text>
          </View>
        </Animated.View>
      </Animated.View>

      {/* Chip flotante. */}
      <Animated.View style={[{ position: "absolute", right: 24, top: 22 }, badgePop]}>
        <Animated.View
          style={[
            { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "#0A0A0B", shadowColor: "#0A0A0B", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
            badgeFloat,
          ]}
        >
          <Shield size={15} color="#C6F24A" strokeWidth={2} />
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Entrega garantizada</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Muestras precalculadas de `TRUST_ROUTE_D` (curva cúbica compuesta), 40 puntos —
 * evita depender de `getPointAtLength` (no disponible en `react-native-svg`). */
const TRUST_ROUTE_SAMPLES = (() => {
  // M 30 100 C 90 100, 90 40, 160 50  S 250 92, 282 32
  // Segmento 1: cúbica (30,100)-(90,100)-(90,40)-(160,50)
  // Segmento 2 ("S"): refleja el control anterior -> (230,60)-(250,92)-(282,32)
  const seg1 = cubicPoints([30, 100], [90, 100], [90, 40], [160, 50], 20);
  const seg2 = cubicPoints([160, 50], [230, 60], [250, 92], [282, 32], 20);
  return [...seg1, ...seg2.slice(1)];
})();

function cubicPoints(p0: number[], p1: number[], p2: number[], p3: number[], n: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
    pts.push({ x, y });
  }
  return pts;
}

/* ───────────────────────── Paso 2 — "Ubicación" (globo) ───────────────────────── */

/**
 * Port del `<canvas>` `MvGlobe` del prototipo. Dos diferencias de técnica (no de
 * resultado), porque RN no tiene `<canvas>`:
 *  - los ~900 puntos de la esfera NO son 900 nodos animados (inviable): se agrupan
 *    en 7 cubos de brillo y cada cubo es UN `<Path>` cuyo `d` se reconstruye en el
 *    hilo de UI por frame (`useDerivedValue`), con cada punto como un segmento de
 *    longitud ~0 y `strokeLinecap="round"`.
 *  - los `createRadialGradient` pasan a `<RadialGradient>`: el glow lime del fondo
 *    (difuminado, no un disco plano) y el relleno metálico de la esfera
 *    (`#303036` con foco arriba a la izquierda → `#0C0C0E`), que es lo que le da
 *    volumen al mundito.
 */

const GLOBE_W = 390;
const GLOBE_H = 330;
const GLOBE_CX = 195;
const GLOBE_CY = 172;
const GLOBE_R = 104;
const GLOBE_TILT = 0.32;
const GLOBE_TILT_COS = Math.cos(GLOBE_TILT);
const GLOBE_TILT_SIN = Math.sin(GLOBE_TILT);
const GLOBE_DOT_COUNT = 900;
const GLOBE_DOT_BUCKETS = 7;
const ORBIT_RX = 172;
const ORBIT_RY = 34;
const ORBIT_CY = GLOBE_CY + 16;
const LIME = "#C6F24A";

const GLOBE_PINS: Array<{ lat: number; lon: number; u: string }> = [
  { lat: 0.45, lon: -0.2, u: "women/44" },
  { lat: -0.15, lon: 0.9, u: "men/46" },
  { lat: 0.3, lon: 2.2, u: "women/65" },
  { lat: -0.4, lon: 3.6, u: "men/32" },
];

function pinVector(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

const GLOBE_PIN_VECTORS = GLOBE_PINS.map((p) => pinVector(p.lat, p.lon));

/** Distribución de Fibonacci sobre la esfera, aplanada a `[x,y,z, x,y,z, ...]` para
 * poder recorrerla en el worklet sin alocar un array por punto en cada frame. */
function fibonacciSphereFlat(n: number): number[] {
  const out: number[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const th = ga * i;
    out.push(Math.cos(th) * r, y, Math.sin(th) * r);
  }
  return out;
}

const GLOBE_DOT_XYZ = fibonacciSphereFlat(GLOBE_DOT_COUNT);

// Arco lime punteado: slerp entre los dos primeros pines, con la altitud
// `1 + .24·sin(πk)` del prototipo (por eso el arco despega de la superficie y
// sigue siendo visible aunque su `z` proyectado sea negativo).
const LINK_A = GLOBE_PIN_VECTORS[0];
const LINK_B = GLOBE_PIN_VECTORS[1];
const LINK_OM = Math.acos(LINK_A[0] * LINK_B[0] + LINK_A[1] * LINK_B[1] + LINK_A[2] * LINK_B[2]);
const LINK_SIN_OM = Math.sin(LINK_OM);
const LINK_STEPS = 48;
const LINK_XYZ = ((): number[] => {
  const out: number[] = [];
  for (let i = 0; i <= LINK_STEPS; i++) {
    const k = i / LINK_STEPS;
    const s1 = Math.sin((1 - k) * LINK_OM) / LINK_SIN_OM;
    const s2 = Math.sin(k * LINK_OM) / LINK_SIN_OM;
    const al = 1 + 0.24 * Math.sin(Math.PI * k);
    out.push(
      (LINK_A[0] * s1 + LINK_B[0] * s2) * al,
      (LINK_A[1] * s1 + LINK_B[1] * s2) * al,
      (LINK_A[2] * s1 + LINK_B[2] * s2) * al,
    );
  }
  return out;
})();

// Velocidades del prototipo, todas derivadas de un único `t` en segundos:
// `rot = t*.22`, `oa = t*.55`, punto del arco en `(t*.3)%1`, pulso del pin `(t%2)/2`.
const GLOBE_ROTATION_PERIOD_MS = (2 * Math.PI * 1000) / 0.22;
const ORBIT_PERIOD_MS = (2 * Math.PI * 1000) / 0.55;
const LINK_DOT_PERIOD_MS = 1000 / 0.3;

/** Rotación sobre el eje Y + inclinación fija. Devuelve `[x, y, z]` proyectados. */
function projectGlobe(
  x: number,
  y: number,
  z: number,
  cr: number,
  sr: number,
): [number, number, number] {
  "worklet";
  const x1 = x * cr + z * sr;
  const z1 = -x * sr + z * cr;
  return [x1, y * GLOBE_TILT_COS - z1 * GLOBE_TILT_SIN, y * GLOBE_TILT_SIN + z1 * GLOBE_TILT_COS];
}

function useLinearLoop(durationMs: number, to: number) {
  const value = useSharedValue(0);
  useEffect(() => {
    value.value = withRepeat(withTiming(to, { duration: durationMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(value);
  }, [durationMs, to, value]);
  return value;
}

/** Un cubo de brillo de la nube de puntos: opacidad y grosor fijos (los del brillo
 * medio del cubo), un solo `<Path>` con todos sus puntos. */
function GlobeDotLayer({ paths, index }: { paths: SharedValue<string[]>; index: number }) {
  const animatedProps = useAnimatedProps(() => ({ d: paths.value[index] ?? "" }));
  const b = (index + 0.5) / GLOBE_DOT_BUCKETS;
  return (
    <AnimatedPath
      animatedProps={animatedProps}
      d=""
      fill="none"
      stroke="#fff"
      strokeWidth={2 * (0.45 + 1.25 * b)}
      strokeLinecap="round"
      strokeOpacity={0.1 + 0.72 * b * b}
    />
  );
}

/** Ancla del pin al mundito: el tallito vertical desde el punto de la superficie
 * hasta la base del avatar, más el puntito sobre la superficie (lime para el pin
 * principal). Va en el SVG, debajo de la capa de avatares. */
function GlobePinAnchor({
  index,
  rotation,
}: {
  index: number;
  rotation: SharedValue<number>;
}) {
  const vec = GLOBE_PIN_VECTORS[index];
  const stemProps = useAnimatedProps(() => {
    const [x, py, pz] = projectGlobe(vec[0], vec[1], vec[2], Math.cos(rotation.value), Math.sin(rotation.value));
    const sc = 0.72 + 0.28 * Math.max(0, pz);
    const sx = GLOBE_CX + x * GLOBE_R;
    const sy = GLOBE_CY - py * GLOBE_R;
    return {
      d: `M${sx} ${sy}L${sx} ${sy - 32 * sc + 19 * sc}`,
      opacity: pz > -0.05 ? Math.min(1, (pz + 0.05) / 0.35) : 0,
    };
  });
  const dotProps = useAnimatedProps(() => {
    const [x, py, pz] = projectGlobe(vec[0], vec[1], vec[2], Math.cos(rotation.value), Math.sin(rotation.value));
    return {
      cx: GLOBE_CX + x * GLOBE_R,
      cy: GLOBE_CY - py * GLOBE_R,
      opacity: pz > -0.05 ? Math.min(1, (pz + 0.05) / 0.35) : 0,
    };
  });
  return (
    <>
      <AnimatedPath animatedProps={stemProps} d="" stroke="rgba(255,255,255,0.45)" strokeWidth={1} fill="none" />
      <AnimatedCircle animatedProps={dotProps} cx={0} cy={0} r={2.5} fill={index === 0 ? LIME : "#fff"} />
    </>
  );
}

/** Avatar del pin, encima del SVG (no se puede dibujar una `<Image>` remota dentro
 * del `<Svg>` con el mismo recorte/borde que el resto de la app). */
function GlobePin({ index, rotation }: { index: number; rotation: SharedValue<number> }) {
  const pin = GLOBE_PINS[index];
  const vec = GLOBE_PIN_VECTORS[index];
  const isPrimary = index === 0;
  const style = useAnimatedStyle(() => {
    const [x, py, pz] = projectGlobe(vec[0], vec[1], vec[2], Math.cos(rotation.value), Math.sin(rotation.value));
    const sc = 0.72 + 0.28 * Math.max(0, pz);
    const sx = GLOBE_CX + x * GLOBE_R;
    const sy = GLOBE_CY - py * GLOBE_R - 32 * sc;
    return {
      opacity: pz > -0.05 ? Math.min(1, (pz + 0.05) / 0.35) : 0,
      // El `scale` se aplica respecto del centro de la vista, así que el translate
      // lleva el centro (no la esquina) al punto proyectado.
      transform: [{ translateX: sx - 19 }, { translateY: sy - 19 }, { scale: sc }],
    };
  });
  return (
    <Animated.View
      style={[{ position: "absolute", left: 0, top: 0, width: 38, height: 38, alignItems: "center", justifyContent: "center" }, style]}
      pointerEvents="none"
    >
      {isPrimary ? <PrimaryPinHalo /> : null}
      <Avatar uri={avatarUri(pin.u)} size={38} ringColor={isPrimary ? LIME : "rgba(255,255,255,0.9)"} />
    </Animated.View>
  );
}

/** Anillo lime que late alrededor del pin principal (`br + 4 + pr*14`, opacidad
 * `(1-pr)*.8` en el prototipo). */
function PrimaryPinHalo() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.8 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 0.61 }],
  }));
  return (
    <Animated.View
      style={[
        { position: "absolute", left: -4, top: -4, width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: LIME },
        style,
      ]}
    />
  );
}

/** Repartidor que recorre la órbita: lime con halo (el `shadowBlur` del canvas se
 * aproxima con un círculo mayor de baja opacidad). `half` decide si se ve por
 * delante o por detrás del mundito. */
function OrbitCourier({ angle, half }: { angle: SharedValue<number>; half: "front" | "back" }) {
  // `isFront` se captura como valor, no como función: un worklet no puede llamar
  // sincrónicamente a una función del hilo de JS ("Tried to synchronously call a
  // Remote Function"), así que el test de visibilidad va inline en cada worklet.
  const isFront = half === "front";
  const glowProps = useAnimatedProps(() => {
    const s = Math.sin(angle.value);
    return {
      cx: GLOBE_CX + Math.cos(angle.value) * ORBIT_RX,
      cy: ORBIT_CY + s * ORBIT_RY,
      opacity: (isFront ? s >= 0 : s < 0) ? 0.3 : 0,
    };
  });
  const coreProps = useAnimatedProps(() => {
    const s = Math.sin(angle.value);
    return {
      cx: GLOBE_CX + Math.cos(angle.value) * ORBIT_RX,
      cy: ORBIT_CY + s * ORBIT_RY,
      opacity: (isFront ? s >= 0 : s < 0) ? 1 : 0,
    };
  });
  return (
    <>
      <AnimatedCircle animatedProps={glowProps} cx={0} cy={0} r={12} fill={LIME} />
      <AnimatedCircle animatedProps={coreProps} cx={0} cy={0} r={5} fill={LIME} />
    </>
  );
}

// La órbita se parte en dos mitades para que la de atrás quede tapada por la esfera
// y la de adelante la cruce por abajo — en el canvas es el orden de dibujado.
const ORBIT_BACK_D = `M${GLOBE_CX - ORBIT_RX} ${ORBIT_CY}A${ORBIT_RX} ${ORBIT_RY} 0 0 1 ${GLOBE_CX + ORBIT_RX} ${ORBIT_CY}`;
const ORBIT_FRONT_D = `M${GLOBE_CX + ORBIT_RX} ${ORBIT_CY}A${ORBIT_RX} ${ORBIT_RY} 0 0 1 ${GLOBE_CX - ORBIT_RX} ${ORBIT_CY}`;

export function LocationIllustration() {
  const rotation = useLinearLoop(GLOBE_ROTATION_PERIOD_MS, 2 * Math.PI);
  const orbitAngle = useLinearLoop(ORBIT_PERIOD_MS, 2 * Math.PI);
  const linkProgress = useLinearLoop(LINK_DOT_PERIOD_MS, 1);

  // Nube de puntos: un `d` por cubo de brillo, reconstruido por frame.
  const dotPaths = useDerivedValue(() => {
    const cr = Math.cos(rotation.value);
    const sr = Math.sin(rotation.value);
    const out: string[] = [];
    for (let k = 0; k < GLOBE_DOT_BUCKETS; k++) out.push("");
    for (let i = 0; i < GLOBE_DOT_XYZ.length; i += 3) {
      const x0 = GLOBE_DOT_XYZ[i];
      const y0 = GLOBE_DOT_XYZ[i + 1];
      const z0 = GLOBE_DOT_XYZ[i + 2];
      const x1 = x0 * cr + z0 * sr;
      const z1 = -x0 * sr + z0 * cr;
      const py = y0 * GLOBE_TILT_COS - z1 * GLOBE_TILT_SIN;
      const pz = y0 * GLOBE_TILT_SIN + z1 * GLOBE_TILT_COS;
      if (pz <= 0) continue;
      const b = -0.4 * x1 + 0.45 * py + 0.8 * pz;
      if (b <= 0) continue;
      let k = Math.floor(b * GLOBE_DOT_BUCKETS);
      if (k >= GLOBE_DOT_BUCKETS) k = GLOBE_DOT_BUCKETS - 1;
      out[k] += `M${(GLOBE_CX + x1 * GLOBE_R).toFixed(1)} ${(GLOBE_CY - py * GLOBE_R).toFixed(1)}h.01`;
    }
    return out;
  });

  // Arco punteado entre los dos primeros pines, cortado donde queda por detrás.
  const linkPath = useDerivedValue(() => {
    const cr = Math.cos(rotation.value);
    const sr = Math.sin(rotation.value);
    let d = "";
    let pen = false;
    for (let i = 0; i < LINK_XYZ.length; i += 3) {
      const x1 = LINK_XYZ[i] * cr + LINK_XYZ[i + 2] * sr;
      const z1 = -LINK_XYZ[i] * sr + LINK_XYZ[i + 2] * cr;
      const py = LINK_XYZ[i + 1] * GLOBE_TILT_COS - z1 * GLOBE_TILT_SIN;
      const pz = LINK_XYZ[i + 1] * GLOBE_TILT_SIN + z1 * GLOBE_TILT_COS;
      if (pz > 0 || x1 * x1 + py * py > 1) {
        d += `${pen ? "L" : "M"}${(GLOBE_CX + x1 * GLOBE_R).toFixed(1)} ${(GLOBE_CY - py * GLOBE_R).toFixed(1)}`;
        pen = true;
      } else {
        pen = false;
      }
    }
    return d;
  });

  const linkPathProps = useAnimatedProps(() => ({ d: linkPath.value }));

  const linkDotProps = useAnimatedProps(() => {
    const k = linkProgress.value;
    const s1 = Math.sin((1 - k) * LINK_OM) / LINK_SIN_OM;
    const s2 = Math.sin(k * LINK_OM) / LINK_SIN_OM;
    const al = 1 + 0.24 * Math.sin(Math.PI * k);
    const [x, py, pz] = projectGlobe(
      (LINK_A[0] * s1 + LINK_B[0] * s2) * al,
      (LINK_A[1] * s1 + LINK_B[1] * s2) * al,
      (LINK_A[2] * s1 + LINK_B[2] * s2) * al,
      Math.cos(rotation.value),
      Math.sin(rotation.value),
    );
    return {
      cx: GLOBE_CX + x * GLOBE_R,
      cy: GLOBE_CY - py * GLOBE_R,
      opacity: pz > 0 || x * x + py * py > 1 ? 1 : 0,
    };
  });

  const buckets = useMemo(() => Array.from({ length: GLOBE_DOT_BUCKETS }, (_, i) => i), []);

  return (
    <View style={{ width: GLOBE_W, height: GLOBE_H, alignSelf: "center" }}>
      <Svg width={GLOBE_W} height={GLOBE_H} style={{ position: "absolute", left: 0, top: 0 }}>
        <Defs>
          <RadialGradient
            id="mvGlobeGlow"
            cx={GLOBE_CX}
            cy={GLOBE_CY}
            r={GLOBE_R * 1.7}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={LIME} stopOpacity={0.14} />
            <Stop offset="0.41" stopColor={LIME} stopOpacity={0.14} />
            <Stop offset="1" stopColor={LIME} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient
            id="mvGlobeBody"
            cx={GLOBE_CX}
            cy={GLOBE_CY}
            r={GLOBE_R}
            fx={GLOBE_CX - GLOBE_R * 0.35}
            fy={GLOBE_CY - GLOBE_R * 0.4}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor="#303036" />
            <Stop offset="1" stopColor="#0C0C0E" />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={GLOBE_W} height={GLOBE_H} fill="url(#mvGlobeGlow)" />

        {/* Mitad de atrás de la órbita: se dibuja antes que la esfera, que la tapa. */}
        <Path d={ORBIT_BACK_D} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={1.2} />
        <OrbitCourier angle={orbitAngle} half="back" />

        {/* Cuerpo metálico del mundito. */}
        <Circle cx={GLOBE_CX} cy={GLOBE_CY} r={GLOBE_R} fill="url(#mvGlobeBody)" />
        {buckets.map((i) => (
          <GlobeDotLayer key={i} paths={dotPaths} index={i} />
        ))}
        <Circle cx={GLOBE_CX} cy={GLOBE_CY} r={GLOBE_R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={1} />

        <AnimatedPath
          animatedProps={linkPathProps}
          d=""
          fill="none"
          stroke={LIME}
          strokeWidth={2}
          strokeDasharray={[3, 5]}
          strokeLinecap="round"
        />
        <AnimatedCircle animatedProps={linkDotProps} cx={0} cy={0} r={9} fill={LIME} opacity={0.3} />
        <AnimatedCircle animatedProps={linkDotProps} cx={0} cy={0} r={4} fill={LIME} />

        {/* Mitad de adelante de la órbita, por encima de la esfera. */}
        <Path d={ORBIT_FRONT_D} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={1.2} />
        <OrbitCourier angle={orbitAngle} half="front" />

        {GLOBE_PINS.map((pin, i) => (
          <GlobePinAnchor key={pin.u} index={i} rotation={rotation} />
        ))}
      </Svg>

      {GLOBE_PINS.map((pin, i) => (
        <GlobePin key={pin.u} index={i} rotation={rotation} />
      ))}
    </View>
  );
}

/* ───────────────────────── Paso 3 — "Notificaciones" ───────────────────────── */

/**
 * Port de `MvNotifs`: un iPhone de perfil con la pantalla de bloqueo (isla, fecha,
 * hora) del que se desvanece la mitad de abajo, y sobre él la pila de
 * notificaciones que se van apilando hacia atrás.
 *
 * El `mask-image` del prototipo (que difumina cuerpo Y borde del teléfono) no
 * existe en RN, así que la carcasa se dibuja como un `<Rect>` de SVG: el relleno y
 * el trazo son cada uno un `<LinearGradient>` que termina en alpha 0 — mismo
 * resultado, sin depender de `@react-native-masked-view`.
 */

const PHONE_X = 70;
const PHONE_Y = 6;
const PHONE_W = 250;
const PHONE_H = 330;
const PHONE_RADIUS = 42;

type NotifItem = { title: string; sub: string; avatar?: string };
const NOTIF_ITEMS: NotifItem[] = [
  { title: "Julia aceptó llevar tu paquete", sub: "Lo retira hoy a las 14:30 en Palermo.", avatar: "women/44" },
  { title: "Tu paquete está en camino", sub: "Llega en 25 min. Seguilo en vivo.", avatar: "women/44" },
  { title: "Entregado en Caballito", sub: "Julia dejó tu paquete. Confirmá la entrega.", avatar: "women/44" },
  { title: "Hay un envío en tu camino", sub: "Palermo a Belgrano · $4.500" },
];
const NOTIF_CYCLE_MS = 2600;

/** Ícono de la app tal como lo dibuja el prototipo (cuadrado redondeado oscuro,
 * círculo blanco, punto oscuro) — a 40px es el avatar de la notificación sin
 * persona, a 18px la insignia sobre el avatar. */
function NotifAppIcon({ size }: { size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        backgroundColor: "#0A0A0B",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.18)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: size * 0.56,
          height: size * 0.56,
          borderRadius: size * 0.28,
          backgroundColor: "#fff",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13, backgroundColor: "#0A0A0B" }} />
      </View>
    </View>
  );
}

function NotifCard({ item, depth }: { item: NotifItem; depth: number }) {
  // El apilado escala desde la base (`transformOrigin: '50% 100%'`), no desde el
  // centro: así las tarjetas viejas se van metiendo hacia arriba y hacia atrás.
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: withTiming(depth * 12, { duration: 550, easing: EASE_OUT }) },
      { scale: withTiming(1 - depth * 0.06, { duration: 550, easing: EASE_OUT }) },
    ],
    opacity: withTiming([1, 0.7, 0.4, 0][depth] ?? 0, { duration: 550 }),
  }));
  const enter = usePopSlideIn();
  return (
    <Animated.View
      style={[
        { position: "absolute", left: 0, right: 0, top: 0, zIndex: 10 - depth, transformOrigin: "50% 100%" },
        style,
      ]}
    >
      <Animated.View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 20,
            backgroundColor: "rgba(44,44,48,0.78)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.1)",
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 16 },
            elevation: 8,
          },
          enter,
        ]}
      >
        <View style={{ width: 40, height: 40 }}>
          {item.avatar ? (
            <>
              <Image
                source={{ uri: avatarUri(item.avatar) }}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#27272B" }}
                resizeMode="cover"
              />
              <View style={{ position: "absolute", right: -3, bottom: -3 }}>
                <NotifAppIcon size={18} />
              </View>
            </>
          ) : (
            <NotifAppIcon size={40} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ fontSize: 14, lineHeight: 17.5, fontWeight: "600", color: "#fff", flexShrink: 1 }}>{item.title}</Text>
            <Text style={{ fontSize: 12, lineHeight: 17.5, color: "rgba(255,255,255,0.5)" }}>ahora</Text>
          </View>
          <Text style={{ fontSize: 13, lineHeight: 17, color: "rgba(255,255,255,0.72)" }}>{item.sub}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/** `mvIn`: la notificación entra desde arriba (translateY −40 + scale .96 + fade). */
function usePopSlideIn() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: 600, easing: EASE_OUT });
    return () => cancelAnimation(progress);
  }, [progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: -40 * (1 - progress.value) }, { scale: 0.96 + 0.04 * progress.value }],
  }));
}

/** Carcasa del teléfono: relleno y borde se desvanecen hacia abajo (el `mask-image`
 * del prototipo), así el mockup no termina en un canto duro. */
function PhoneShell() {
  return (
    <Svg width={GLOBE_W} height={GLOBE_H} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
      <Defs>
        <LinearGradient id="mvPhoneBody" x1="0" y1={PHONE_Y} x2="0" y2={PHONE_Y + PHONE_H} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#17171A" stopOpacity={1} />
          <Stop offset="0.55" stopColor="#0E0E10" stopOpacity={1} />
          <Stop offset="1" stopColor="#0A0A0B" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="mvPhoneEdge" x1="0" y1={PHONE_Y} x2="0" y2={PHONE_Y + PHONE_H} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#fff" stopOpacity={0.14} />
          <Stop offset="0.55" stopColor="#fff" stopOpacity={0.14} />
          <Stop offset="1" stopColor="#fff" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect
        x={PHONE_X}
        y={PHONE_Y}
        width={PHONE_W}
        height={PHONE_H}
        rx={PHONE_RADIUS}
        ry={PHONE_RADIUS}
        fill="url(#mvPhoneBody)"
        stroke="url(#mvPhoneEdge)"
        strokeWidth={1.5}
      />
    </Svg>
  );
}

export function NotificationsIllustration() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), NOTIF_CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  const cards = [];
  for (let k = Math.max(0, n - 3); k <= n; k++) {
    cards.push(<NotifCard key={k} item={NOTIF_ITEMS[k % NOTIF_ITEMS.length]} depth={n - k} />);
  }

  return (
    <View style={{ width: GLOBE_W, height: GLOBE_H, alignSelf: "center" }}>
      <PhoneShell />
      <View style={{ position: "absolute", top: PHONE_Y + 12, left: PHONE_X + PHONE_W / 2 - 36, width: 72, height: 22, borderRadius: 12, backgroundColor: "#000" }} />
      <Text
        style={{
          position: "absolute",
          top: PHONE_Y + 40,
          left: PHONE_X,
          width: PHONE_W,
          textAlign: "center",
          fontSize: 12,
          fontWeight: "500",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        Martes 22 de septiembre
      </Text>
      <Text
        style={{
          position: "absolute",
          top: PHONE_Y + 54,
          left: PHONE_X,
          width: PHONE_W,
          textAlign: "center",
          fontSize: 52,
          lineHeight: 56,
          fontWeight: "600",
          letterSpacing: -2.1,
          color: "rgba(255,255,255,0.88)",
        }}
      >
        9:41
      </Text>
      <View style={{ position: "absolute", left: 30, right: 30, top: 150 }}>{cards}</View>
    </View>
  );
}

/* ───────────────────────── Paso 4 — "Cámara" ───────────────────────── */

const CAM_SCAN_INTERVAL_MS = 2300;
const CAM_OK_DURATION_MS = 1700;

function CameraCorner({ style, ok }: { style: object; ok: boolean }) {
  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: withTiming(ok ? "#C6F24A" : "rgba(255,255,255,0.85)", { duration: 250 }),
  }));
  return <Animated.View style={[{ position: "absolute", width: 30, height: 30, borderColor: "rgba(255,255,255,0.85)" }, style, animatedStyle]} />;
}

export function CameraIllustration() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      setOk(false);
      timer = setTimeout(() => {
        setOk(true);
        timer = setTimeout(run, CAM_OK_DURATION_MS);
      }, CAM_SCAN_INTERVAL_MS);
    };
    run();
    return () => clearTimeout(timer);
  }, []);

  const scan = useSharedValue(0);
  useEffect(() => {
    scan.value = withRepeat(withTiming(1, { duration: 1150, easing: EASE_IN_OUT }), -1, true);
    return () => cancelAnimation(scan);
  }, [scan]);
  const scanStyle = useAnimatedStyle(() => ({ top: 18 + scan.value * 168, opacity: ok ? 0 : 1 }));

  const flash = useSharedValue(0);
  useEffect(() => {
    if (ok) {
      flash.value = 0.8;
      flash.value = withTiming(0, { duration: 500, easing: Easing.out(Easing.ease) });
    }
  }, [ok, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  const shutterInnerStyle = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(ok ? 0.82 : 1, { duration: 200 }) }] }));

  return (
    <View style={{ width: 390, height: 330, alignSelf: "center", alignItems: "center" }}>
      <View style={{ marginTop: 14, width: 270, height: 236, borderRadius: 20, backgroundColor: "#111113", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        <Package size={72} color="#fff" strokeWidth={1.4} />
        <Animated.View style={[{ position: "absolute", left: 18, right: 18, height: 2, borderRadius: 1, backgroundColor: "#C6F24A", shadowColor: "#C6F24A", shadowOpacity: 0.55, shadowRadius: 6 }, scanStyle]} />
        <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: 0, backgroundColor: "#fff" }, flashStyle]} />
        <CameraCorner ok={ok} style={{ left: 14, top: 14, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 10 }} />
        <CameraCorner ok={ok} style={{ right: 14, top: 14, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 10 }} />
        <CameraCorner ok={ok} style={{ left: 14, bottom: 14, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 10 }} />
        <CameraCorner ok={ok} style={{ right: 14, bottom: 14, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 10 }} />
        {ok ? (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 22, alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "#C6F24A" }}>
              <Shield size={14} color="#0A0A0B" strokeWidth={2.5} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#0A0A0B" }}>Listo</Text>
            </View>
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: 22, width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: "#fff", padding: 4 }}>
        <Animated.View style={[{ flex: 1, borderRadius: 22, backgroundColor: "#fff" }, shutterInnerStyle]} />
      </View>
    </View>
  );
}

/* ───────────────────────── Paso 5 — "Listo" ───────────────────────── */

const READY_RING_RADII = [182, 170.6, 157, 140.9, 124].map((r) => r / 182);
const READY_GREY = ["#DADADA", "#B6B6B6", "#717172", "#222223"];
const READY_LIME = ["#E3FA98", "#D6F771", "#C6F24A", "#9FC72E"];
const READY_FACES = ["women/44", "men/46", "women/12", "men/75", "women/65", "men/32"];
const READY_R = 80;
const READY_ORBIT_R = 150;

function ReadyRingBand({ index }: { index: number }) {
  const size = 2 * READY_RING_RADII[index] * READY_R;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(550 + (3 - index) * 120, withTiming(1, { duration: 450 }));
    return () => cancelAnimation(progress);
  }, [index, progress]);
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  return (
    <>
      <View style={{ position: "absolute", left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: READY_GREY[index] }} />
      <Animated.View style={[{ position: "absolute", left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: READY_LIME[index] }, style]} />
    </>
  );
}

export function ReadyIllustration() {
  const holeSize = 2 * READY_RING_RADII[4] * READY_R;
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 48000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rotation);
  }, [rotation]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-rotation.value}deg` }] }));

  return (
    <View style={{ width: 390, height: 420, alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
      {[0, 1].map((i) => (
        <RadarRing key={i} delayMs={1100 + i * 1600} />
      ))}
      <View
        style={{
          position: "absolute",
          left: 195 - READY_ORBIT_R,
          top: 210 - READY_ORBIT_R,
          width: READY_ORBIT_R * 2,
          height: READY_ORBIT_R * 2,
          borderRadius: READY_ORBIT_R,
          borderWidth: 1,
          borderColor: "rgba(10,10,11,0.14)",
          borderStyle: "dashed",
        }}
      />
      <View style={{ width: 0, height: 0, alignItems: "center", justifyContent: "center" }}>
        {[0, 1, 2, 3].map((i) => (
          <ReadyRingBand key={i} index={i} />
        ))}
        <View style={{ position: "absolute", left: -holeSize / 2, top: -holeSize / 2, width: holeSize, height: holeSize, borderRadius: holeSize / 2, backgroundColor: "#fff" }} />
      </View>
      <Animated.View
        style={[
          { position: "absolute", left: 195 - READY_ORBIT_R, top: 210 - READY_ORBIT_R, width: READY_ORBIT_R * 2, height: READY_ORBIT_R * 2 },
          ringStyle,
        ]}
      >
        {READY_FACES.map((u, i) => {
          const a = (i / READY_FACES.length) * Math.PI * 2 - Math.PI / 2;
          const s = i % 2 ? 44 : 52;
          return (
            <Animated.View
              key={u}
              style={[
                { position: "absolute", left: READY_ORBIT_R + Math.cos(a) * READY_ORBIT_R - s / 2, top: READY_ORBIT_R + Math.sin(a) * READY_ORBIT_R - s / 2, width: s, height: s },
                counterStyle,
              ]}
            >
              <Avatar uri={avatarUri(u)} size={s} />
            </Animated.View>
          );
        })}
      </Animated.View>
    </View>
  );
}

function RadarRing({ delayMs }: { delayMs: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delayMs, withRepeat(withTiming(1, { duration: 3200, easing: EASE_OUT }), -1, false));
    return () => cancelAnimation(progress);
  }, [delayMs, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.value),
    transform: [{ scale: 0.3 + progress.value * 0.9 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", width: 340, height: 340, borderRadius: 170, borderWidth: 1.5, borderColor: "rgba(159,199,46,0.55)" },
        style,
      ]}
    />
  );
}
