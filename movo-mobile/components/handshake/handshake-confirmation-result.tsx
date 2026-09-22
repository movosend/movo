import { useEffect } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { Path, Svg } from "react-native-svg";
import type { ConfirmHandshakeResult } from "../../src/api/shipments-client";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useShipment, useShipmentRoute } from "../../src/hooks/use-shipments";
import { activeShipmentDisplayCode } from "../../src/lib/active-shipment-format";
import {
  formatConfirmedAtTime,
  formatDurationMin,
  formatRouteDistanceKm,
  shortAddressLabel,
} from "../../src/lib/shipment-format";

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface HandshakeConfirmationResultProps {
  result: ConfirmHandshakeResult;
  /** Sin esta prop, no se muestra ningún CTA -- este componente sigue sin ser dueño
   * de la navegación (mismo criterio de siempre), pero el rediseño (MOVO-198) lo hornea
   * DENTRO de la hoja blanca en vez de dejarlo para que el caller lo agregue debajo. */
  onCtaPress?: () => void;
  /** Default por stage si no se pasa: "Ver la ruta" (retiro) / "Volver al envío"
   * (entrega). */
  ctaLabel?: string;
  /** CTA secundario, opcional (MOVO-199 AC9: acceso a calificar a la contraparte
   * desde el éxito de entrega) -- outline, debajo del primario dentro de la misma
   * hoja. Sin esta prop no se renderiza nada, retrocompatible con los 3 callers que
   * ya existían antes (`pickup/success.tsx`, `handshake-scan.tsx` standalone,
   * `/dev-handshake`). Requiere `onCtaPress` (no tiene sentido un CTA secundario sin
   * uno primario). */
  secondaryCtaLabel?: string;
  onSecondaryCtaPress?: () => void;
  testID?: string;
}

const WIPE_DURATION_MS = 900;
const CHECK_FADE_DELAY_MS = 680;
const CHECK_FADE_DURATION_MS = 240;
const CHECK_DRAW_DELAY_MS = 720;
const CHECK_DRAW_DURATION_MS = 700;
const CHECK_DASH_LENGTH = 40;
const TITLE_DELAY_MS = 1240;
const TITLE_DURATION_MS = 560;
const SHEET_DELAY_MS = 1780;
const SHEET_DURATION_MS = 640;
const BAR_DELAY_MS = 2300;
const BAR_DURATION_MS = 900;

const EASE_OUT = Easing.out(Easing.cubic);

/**
 * Pantalla de éxito del escaneo (MOVO-160 AC4), rediseñada en MOVO-198 sobre el
 * prototipo "Success de entrega" de Claude Design: barrido lime desde el centro
 * (imita el `clip-path` del mock con un círculo escalado -- `react-native-svg` no
 * soporta clip-path de forma confiable, ver el comentario de `app/(auth)/kyc.tsx`),
 * check dibujado con `strokeDashoffset` animado (mismo patrón que `AnimatedCircle`
 * de `publish-shipment-button.tsx`), título y hoja blanca inferior en cascada.
 *
 * Fetch propio (`useShipment`/`usePublicProfile`/`useShipmentRoute`) en vez de
 * recibir más props: el `ConfirmHandshakeResult` de la API no trae ni la dirección
 * de entrega ni el nombre del receptor, y este componente ya vive detrás de 3
 * callers distintos -- pedirles que resuelvan y pasen esos datos hubiera duplicado
 * el mismo fetch en cada uno.
 *
 * Sin pill de "ubicación en vivo" del mock (decisión tomada con el usuario): no hay
 * tracking en tiempo real todavía (MOVO-11/203 sin construir) y afirmarlo sería
 * mentir. La ruta/ETA hacia la entrega sí es real (`GET /shipments/route`,
 * ADR-015) -- mismo dato que ya muestra `transport/[id].tsx`.
 */
export function HandshakeConfirmationResult({
  result,
  onCtaPress,
  ctaLabel,
  secondaryCtaLabel,
  onSecondaryCtaPress,
  testID,
}: HandshakeConfirmationResultProps) {
  const { data: shipment } = useShipment(result.shipmentId);
  const isPickup = result.stage === "pickup";

  const receiverProfile = usePublicProfile(isPickup ? shipment?.receiverId : undefined);
  const route = useShipmentRoute(
    isPickup && shipment ? { lat: shipment.pickupLat, lng: shipment.pickupLng } : null,
    isPickup && shipment ? { lat: shipment.deliveryLat, lng: shipment.deliveryLng } : null,
  );

  const wipe = useSharedValue(0);
  const checkOpacity = useSharedValue(0);
  const checkDraw = useSharedValue(0);
  const title = useSharedValue(0);
  const sheet = useSharedValue(0);
  const bar = useSharedValue(0);

  useEffect(() => {
    wipe.value = withTiming(1, { duration: WIPE_DURATION_MS, easing: EASE_OUT });
    checkOpacity.value = withDelay(CHECK_FADE_DELAY_MS, withTiming(1, { duration: CHECK_FADE_DURATION_MS }));
    checkDraw.value = withDelay(CHECK_DRAW_DELAY_MS, withTiming(1, { duration: CHECK_DRAW_DURATION_MS, easing: EASE_OUT }));
    title.value = withDelay(TITLE_DELAY_MS, withTiming(1, { duration: TITLE_DURATION_MS, easing: EASE_OUT }));
    sheet.value = withDelay(SHEET_DELAY_MS, withTiming(1, { duration: SHEET_DURATION_MS, easing: EASE_OUT }));
    bar.value = withDelay(BAR_DELAY_MS, withTiming(1, { duration: BAR_DURATION_MS, easing: EASE_OUT }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wipeStyle = useAnimatedStyle(() => ({ transform: [{ scale: wipe.value }] }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: checkOpacity.value }));
  const checkAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_DASH_LENGTH * (1 - checkDraw.value),
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: title.value,
    transform: [{ translateY: (1 - title.value) * 10 }],
  }));
  const { width: screenW, height: screenH } = Dimensions.get("window");
  const wipeDiameter = Math.hypot(screenW, screenH) * 2.2;

  const sheetStyle = useAnimatedStyle(() => ({
    // Numérico, no un `%` de string -- mismo criterio que `use-sheet-animation.ts`
    // (sin precedente en el repo de transform con porcentaje, y el alto de la hoja
    // varía con su contenido). `screenH` alcanza y sobra para empujarla fuera.
    transform: [{ translateY: (1 - sheet.value) * screenH }],
  }));
  const barStyle = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));

  const timeLabel = formatConfirmedAtTime(result.confirmedAt);
  const deliveryAddress = shipment ? shortAddressLabel(shipment.deliveryAddress) : null;
  const receiverFirstName = receiverProfile.data?.fullName.split(" ")[0];
  const shipmentCode = shipment ? activeShipmentDisplayCode(shipment.id) : "";

  const eyebrow = isPickup
    ? `Retiro confirmado${timeLabel ? ` · ${timeLabel}` : ""}`
    : `Entrega confirmada${timeLabel ? ` · ${timeLabel}` : ""}`;
  const title1 = isPickup ? "Lo tenés vos." : "Listo.";
  const title2 = isPickup ? (deliveryAddress ? `Ahora, a ${deliveryAddress}.` : "Ahora, a la entrega.") : "Se lo entregaste.";
  const resolvedCtaLabel = ctaLabel ?? (isPickup ? "Ver la ruta" : "Volver al envío");

  return (
    <View testID={testID} className="flex-1 overflow-hidden bg-ink-950">
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            left: screenW / 2 - wipeDiameter / 2,
            top: screenH * 0.42 - wipeDiameter / 2,
            width: wipeDiameter,
            height: wipeDiameter,
            borderRadius: wipeDiameter / 2,
            backgroundColor: "#C6F24A",
          },
          wipeStyle,
        ]}
      />

      <View className="flex-1 items-center justify-center gap-6 px-8">
        <Animated.View style={checkStyle}>
          <Svg width={72} height={72} viewBox="0 0 24 24" fill="none">
            <AnimatedPath
              d="M20 6L9 17l-5-5"
              stroke="#0A0A0B"
              strokeWidth={2.1}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={CHECK_DASH_LENGTH}
              animatedProps={checkAnimatedProps}
            />
          </Svg>
        </Animated.View>

        <Animated.View style={titleStyle} className="items-center gap-2">
          <Text className="font-sans-semibold text-caption uppercase text-ink-950/60">{eyebrow}</Text>
          <Text className="text-center font-sans-semibold text-[28px] leading-8 tracking-tight text-ink-950">
            {title1}
            {"\n"}
            {title2}
          </Text>
        </Animated.View>
      </View>

      <Animated.View style={sheetStyle} className="gap-4 rounded-t-[14px] bg-paper px-5 pb-6 pt-5">
        <Text className="font-mono text-[13px] text-ink-600">{shipmentCode}</Text>

        {isPickup ? (
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-sans text-[13px] text-ink-500">
                {receiverFirstName ? `${receiverFirstName} · destinataria` : "Destinatario"}
              </Text>
              {route.data ? (
                <Text className="font-mono text-[13px] text-ink-600">
                  {formatDurationMin(route.data.durationSeconds)} · {formatRouteDistanceKm(route.data.distanceMeters)}
                </Text>
              ) : null}
            </View>
            <View className="h-[3px] overflow-hidden rounded-full bg-ink-950/10">
              <Animated.View style={barStyle} className="h-full bg-lime-500" />
            </View>
          </View>
        ) : (
          <Text className="font-sans text-[13px] text-ink-500">El pago se está procesando.</Text>
        )}

        {onCtaPress ? (
          <Pressable
            testID={testID ? `${testID}-cta` : undefined}
            onPress={onCtaPress}
            className="w-full items-center justify-center rounded-lg bg-ink-950 py-3.5 active:opacity-85"
          >
            <Text className="font-sans-semibold text-body text-paper">{resolvedCtaLabel}</Text>
          </Pressable>
        ) : null}

        {onSecondaryCtaPress && secondaryCtaLabel ? (
          <Pressable
            testID={testID ? `${testID}-secondary-cta` : undefined}
            onPress={onSecondaryCtaPress}
            className="w-full items-center justify-center rounded-lg border border-ink-950/15 py-3.5 active:opacity-70"
          >
            <Text className="font-sans-semibold text-body text-ink-950">{secondaryCtaLabel}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}
