import { LinearGradient as ExpoLinearGradient } from "expo-linear-gradient";
import { type ReactNode, useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import type { CardBrandKey } from "../../src/lib/card-brand";
import { BankLogo } from "./bank-logo";
import { CardBrandLogo } from "./card-brand-logo";

/**
 * Tarjeta en 3D del alta (MOVO-101), fiel al prototipo "MOVO-112 Pagos y cobros v2":
 * frente claro con anillos que se vuelve cromado a medida que se completan los datos, chip,
 * número con bullets, titular y vencimiento; el dorso con la banda y el código. Gira al
 * enfocar el código de seguridad y resalta en lima el dato que se está escribiendo. Un
 * barrido de luz la recorre al pasar de paso y en loop mientras se valida.
 *
 * Colores fijos (no siguen el tema): representa el plástico, igual en claro y oscuro.
 * Desvío: el tilt con el mouse del prototipo no se porta, en mobile no hay hover.
 */

export type CardPreviewFocus = "num" | "exp" | "cvv" | "name" | "dni" | "alias" | null;

export interface CardPreview3DProps {
  /** Solo dígitos. */
  number: string;
  /** Solo dígitos, MMAA. */
  exp: string;
  cvv: string;
  name: string;
  focus: CardPreviewFocus;
  flipped: boolean;
  brand: CardBrandKey | null;
  /** Banco detectado por el BIN (nombre completo de MP). */
  bankName: string | null;
  /** 0..1: cuánto del formulario está completo (el cromado aparece con esto). */
  progress: number;
  busy: boolean;
  /** Cambia al pasar de paso: dispara un barrido de luz. */
  sweepKey: number;
  error: boolean;
}

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const CARD_HEIGHT = 220;
const RADIUS = 14;
const LIME_HL = "rgba(198,242,74,0.7)";

function ChromeFill({ id }: { id: string }) {
  return (
    <Svg width="100%" height="100%" style={{ position: "absolute" }} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={`${id}-lin`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F2F2F2" />
          <Stop offset="0.45" stopColor="#D8D8D8" />
          <Stop offset="1" stopColor="#C2C2C2" />
        </LinearGradient>
        <RadialGradient id={`${id}-r1`} cx="12%" cy="18%" rx="55%" ry="45%" fx="12%" fy="18%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.72} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}-r2`} cx="78%" cy="22%" rx="40%" ry="50%" fx="78%" fy="22%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}-r3`} cx="88%" cy="82%" rx="50%" ry="40%" fx="88%" fy="82%">
          <Stop offset="0" stopColor="#A0A0A0" stopOpacity={0.38} />
          <Stop offset="1" stopColor="#A0A0A0" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}-r4`} cx="28%" cy="78%" rx="35%" ry="55%" fx="28%" fy="78%">
          <Stop offset="0" stopColor="#C8C8C8" stopOpacity={0.22} />
          <Stop offset="1" stopColor="#C8C8C8" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id}-lin)`} />
      <Rect width="100%" height="100%" fill={`url(#${id}-r4)`} />
      <Rect width="100%" height="100%" fill={`url(#${id}-r3)`} />
      <Rect width="100%" height="100%" fill={`url(#${id}-r2)`} />
      <Rect width="100%" height="100%" fill={`url(#${id}-r1)`} />
    </Svg>
  );
}

/** Anillos concéntricos desde abajo a la izquierda (`repeating-radial-gradient` del prototipo). */
function Rings({ width }: { width: number }) {
  const cx = -0.1 * width;
  const cy = 1.3 * CARD_HEIGHT;
  const maxR = Math.hypot(width - cx, cy);
  const circles: number[] = [];
  for (let r = 13.5; r < maxR; r += 14) circles.push(r);
  return (
    <Svg width="100%" height="100%" style={{ position: "absolute" }}>
      {circles.map((r) => (
        <Circle key={r} cx={cx} cy={cy} r={r} stroke="rgba(10,10,11,0.08)" strokeWidth={1} fill="none" />
      ))}
    </Svg>
  );
}

function Chip() {
  return (
    <Svg width={44} height={34} viewBox="0 0 44 34">
      <Defs>
        <LinearGradient id="chipG" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FAFAFB" />
          <Stop offset="0.5" stopColor="#DADADF" />
          <Stop offset="1" stopColor="#B9B9C0" />
        </LinearGradient>
      </Defs>
      <Rect x={0.5} y={0.5} width={43} height={33} rx={7} fill="url(#chipG)" stroke="rgba(10,10,11,0.22)" />
      <G fill="none" stroke="rgba(10,10,11,0.28)" strokeWidth={1} strokeLinecap="round">
        <Path d="M15 0.5V8.5M29 0.5V8.5M15 25.5V33.5M29 25.5V33.5" />
        <Path d="M0.5 12H15M0.5 22H15M29 12H43.5M29 22H43.5" />
        <Rect x={15} y={8.5} width={14} height={17} rx={4} />
      </G>
    </Svg>
  );
}

/** Fondo lima detrás del dato enfocado, con el fundido de 200ms del prototipo. */
function Highlight({ on, children, style }: { on: boolean; children: ReactNode; style?: object }) {
  const value = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    value.value = withTiming(on ? 1 : 0, { duration: 200, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  // `interpolateColor` y no un template string: con valores chicos JS escribe el alfa en
  // notación científica ("2.9e-7") y Reanimated rechaza el color.
  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(value.value, [0, 1], ["rgba(198,242,74,0)", LIME_HL]),
  }));
  return (
    <Animated.View style={[{ borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, margin: -3, marginHorizontal: -6 }, style, animated]}>
      {children}
    </Animated.View>
  );
}

/** Aparece bajando 4px con fundido (banco y marca, cuando se detectan). */
function Reveal({ shown, children, style }: { shown: boolean; children: ReactNode; style?: object }) {
  const value = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    value.value = withTiming(shown ? 1 : 0, { duration: 300, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const animated = useAnimatedStyle(() => ({
    opacity: value.value,
    transform: [{ translateY: (1 - value.value) * -4 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

function Sweep({ width, busy, sweepKey }: { width: number; busy: boolean; sweepKey: number }) {
  const x = useSharedValue(-1);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    cancelAnimation(x);
    if (busy) {
      setVisible(true);
      x.value = -1;
      x.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
      return;
    }
    if (sweepKey > 0) {
      setVisible(true);
      x.value = -1;
      x.value = withTiming(1, { duration: 900, easing: EASE_OUT });
      const timer = setTimeout(() => setVisible(false), 950);
      return () => clearTimeout(timer);
    }
    setVisible(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, sweepKey]);

  const band = width * 1.2;
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(x.value, [-1, 1], [-band, width]) }],
  }));
  if (!visible || width === 0) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, bottom: 0, width: band }, animated]}>
      <ExpoLinearGradient
        colors={["rgba(255,255,255,0)", `rgba(255,255,255,${busy ? 0.9 : 0.8})`, "rgba(255,255,255,0)"]}
        locations={[0.35, 0.5, 0.65]}
        start={{ x: 0, y: 0.35 }}
        end={{ x: 1, y: 0.65 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

function groupedNumber(number: string): string {
  return Array.from({ length: 16 }, (_, i) => number[i] ?? "•")
    .join("")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function expiryPreview(exp: string): string {
  const e4 = Array.from({ length: 4 }, (_, i) => exp[i] ?? "MMAA"[i]).join("");
  return `${e4.slice(0, 2)}/${e4.slice(2)}`;
}

export function CardPreview3D(props: CardPreview3DProps) {
  const { number, exp, cvv, name, focus, flipped, brand, bankName, progress, busy, sweepKey, error } = props;
  const [width, setWidth] = useState(0);
  const flip = useSharedValue(flipped ? 1 : 0);
  const fill = useSharedValue(progress);

  useEffect(() => {
    flip.value = withTiming(flipped ? 1 : 0, { duration: 500, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped]);
  useEffect(() => {
    fill.value = withTiming(progress, { duration: 500, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1100 }, { rotateY: `${flip.value * 180}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1100 }, { rotateY: `${180 + flip.value * 180}deg` }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({ shadowOpacity: 0.1 + fill.value * 0.14 }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  const sheenStyle = useAnimatedStyle(() => ({ opacity: 0.15 + fill.value * 0.6 }));

  const face = {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: RADIUS,
    overflow: "hidden" as const,
    backfaceVisibility: "hidden" as const,
  };
  const hasName = name.trim().length > 0;

  return (
    <View
      testID="card-preview"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: CARD_HEIGHT }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: RADIUS,
            shadowColor: "#0A0A0B",
            shadowOffset: { width: 0, height: 14 },
            shadowRadius: 16,
            elevation: 6,
            backgroundColor: "#F8F8FA",
          },
          shadowStyle,
        ]}
      >
        {/* Frente */}
        <Animated.View
          testID="card-preview-front"
          style={[face, { borderWidth: error ? 1.5 : 1, borderColor: error ? "#E5484D" : "rgba(10,10,11,0.14)" }, frontStyle]}
        >
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#F8F8FA" }} />
          {width > 0 ? <Rings width={width} /> : null}
          <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, chromeStyle]}>
            <ChromeFill id="front" />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, sheenStyle]}>
            <ExpoLinearGradient
              colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.75)", "rgba(255,255,255,0)"]}
              locations={[0.3, 0.48, 0.62]}
              start={{ x: 0, y: 0.2 }}
              end={{ x: 1, y: 0.8 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
          <Sweep width={width} busy={busy} sweepKey={sweepKey} />

          <View style={{ flex: 1, paddingHorizontal: 20, paddingVertical: 18, justifyContent: "space-between" }}>
            <View style={{ height: 30, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <Reveal shown={!!bankName} style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 }}>
                {bankName ? <BankLogo issuerName={bankName} size={22} testID="card-preview-bank-logo" /> : null}
                <Text
                  testID="card-preview-bank"
                  numberOfLines={1}
                  style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, letterSpacing: -0.1, color: "#0A0A0B", flexShrink: 1 }}
                >
                  {bankName ?? ""}
                </Text>
              </Reveal>
              <Reveal shown={!!brand}>
                <CardBrandLogo testID="card-preview-brand" brand={brand} size={30} color="#8A8A93" />
              </Reveal>
            </View>

            <View style={{ gap: 14 }}>
              <Chip />
              <Highlight on={focus === "num"} style={{ alignSelf: "flex-start" }}>
                <Text
                  testID="card-preview-number"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{ fontFamily: "JetBrainsMono_500Medium", fontSize: 20, letterSpacing: 1.2, color: "#0A0A0B" }}
                >
                  {groupedNumber(number)}
                </Text>
              </Highlight>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
                <Highlight on={focus === "name"} style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, letterSpacing: 0.72, color: "#3A3A40" }}>TITULAR</Text>
                  <Text
                    testID="card-preview-name"
                    numberOfLines={1}
                    style={{
                      marginTop: 3,
                      fontFamily: "Inter_500Medium",
                      fontSize: 13,
                      letterSpacing: 0.52,
                      color: hasName ? "#0A0A0B" : "#8A8A93",
                    }}
                  >
                    {hasName ? name.toUpperCase() : "NOMBRE Y APELLIDO"}
                  </Text>
                </Highlight>
                <Highlight on={focus === "exp"}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, letterSpacing: 0.72, color: "#3A3A40" }}>VENCE</Text>
                  <Text
                    testID="card-preview-exp"
                    style={{ marginTop: 3, fontFamily: "JetBrainsMono_500Medium", fontSize: 13, color: "#0A0A0B" }}
                  >
                    {expiryPreview(exp)}
                  </Text>
                </Highlight>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Dorso */}
        <Animated.View
          testID="card-preview-back"
          style={[face, { borderWidth: 1, borderColor: "rgba(10,10,11,0.12)" }, backStyle]}
        >
          <ChromeFill id="back" />
          <View style={{ flex: 1, paddingTop: 22, paddingBottom: 18, gap: 18 }}>
            <View style={{ height: 40, backgroundColor: "#0A0A0B" }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20 }}>
              <View
                style={{
                  flex: 1,
                  height: 34,
                  borderRadius: 4,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: "rgba(10,10,11,0.12)",
                }}
              >
                <Svg width="100%" height="100%">
                  <Defs>
                    <Pattern id="sig" width={12} height={12} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <Rect width={12} height={12} fill="#FFFFFF" />
                      <Line x1={9} y1={0} x2={9} y2={12} stroke="#EDEDF0" strokeWidth={6} />
                    </Pattern>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#sig)" />
                </Svg>
              </View>
              <View
                style={{
                  borderRadius: 5,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: "rgba(10,10,11,0.12)",
                  backgroundColor: focus === "cvv" ? LIME_HL : "#FFFFFF",
                }}
              >
                <Text
                  testID="card-preview-cvv"
                  style={{ fontFamily: "JetBrainsMono_500Medium", fontSize: 16, letterSpacing: 1.6, color: "#0A0A0B" }}
                >
                  {cvv.padEnd(3, "•")}
                </Text>
              </View>
            </View>
            <Text style={{ paddingHorizontal: 20, fontFamily: "Inter_400Regular", fontSize: 10.5, lineHeight: 14, color: "#3A3A40" }}>
              El código de seguridad son los 3 dígitos del dorso (4 en el frente si es American Express).
            </Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
