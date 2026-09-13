import { Flag, MapPin, Package, Route } from "lucide-react-native";
import { Fragment, useEffect } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import type { ActiveShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  ACTIVE_SHIPMENT_STEPS,
  activeShipmentCta,
  activeShipmentDisplayCode,
  activeShipmentFooterText,
  activeShipmentStatusLabel,
  activeShipmentStepIndex,
  activeShipmentSubtitle,
  type ActiveShipmentRole,
} from "../../src/lib/active-shipment-format";
import { formatPickupWindowLabel, shortAddressLabel } from "../../src/lib/shipment-format";
import { GradientBorderCard } from "../ui/gradient-border-card";

const STEP_ICONS = [MapPin, Route, Package, Flag];

const STEP_NODE_SIZE = 38;
/** Ancho explícito del label de cada paso, mayor al de la columna (`STEP_NODE_SIZE`)
 * — suficiente para que "En camino"/"Llegando" (los más largos de los 4) entren en
 * una sola línea sin truncarse. Ver el comentario junto al `Text` que lo usa. */
const STEP_LABEL_WIDTH = 76;
const PULSE_DURATION_MS = 1400;

/** Halo detrás del nodo "En camino" mientras es el paso actual (`in_transit`) — el
 * único paso de esta fase que representa una acción realmente en curso (Retiro
 * "actual" es solo "todavía no salió", no algo pasando ahora). Efecto de "radar"
 * (crece y se desvanece en loop), no un simple parpadeo de opacidad: transmite
 * mejor "envío en movimiento" que el pulso 0.5↔1 que ya usa `SkeletonBlock` para
 * loading, que es un caso semántico distinto. */
function PulsingStepRing({ color }: { color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.out(Easing.ease) }), -1, false);
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: (1 - progress.value) * 0.45,
    transform: [{ scale: 1 + progress.value * 0.7 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: STEP_NODE_SIZE,
          height: STEP_NODE_SIZE,
          borderRadius: 999,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

/**
 * Card de un envío activo del home operativo (MOVO-193) — réplica 1:1 de la
 * estructura de la live card de "Home operativo v2.dc.html" (Claude Design):
 * encabezado (código corto + contraparte / pill de estado), stepper de 4 pasos
 * fijos, franja de retiro/entrega en dos columnas, y fila inferior con texto +
 * acción. El código del encabezado es derivado del `id` real (ver
 * `activeShipmentDisplayCode`), no un dato inventado ni el precio del envío.
 *
 * Dos "skins" (no las 4 del prototipo — chrome/titanio/lime/ink eran una
 * exploración de tonos del propio diseñador, no estados de negocio distintos): el
 * tono "chrome" por defecto del prototipo para un envío con fondos confirmados
 * (`assigned`/`in_transit`), y el tono "papel" (`proximo` en el prototipo) para
 * `assigned_unfunded` — el envío todavía no arrancó de verdad. El estado "llegando"
 * del prototipo (ETA de proximidad) se descartó: requiere tracking en vivo
 * (MOVO-203/MOVO-11), fuera del contrato de MOVO-192 — el stepper nunca marca ese
 * paso como actual, ver `activeShipmentStepIndex`.
 */
export function ActiveShipmentCard({
  shipment,
  role,
  testID,
}: {
  shipment: ActiveShipmentSummary;
  role: ActiveShipmentRole;
  testID?: string;
}) {
  const colors = useThemeColors();
  const isUnfunded = shipment.status === "assigned_unfunded";
  const cta = activeShipmentCta(role, shipment);
  const activeIndex = activeShipmentStepIndex(shipment.status);

  const handleCta = () => {
    if (!cta) return;
    // MOVO-159/160 todavía no tienen pantalla propia en el repo — mismo criterio que
    // "Abrir Mis ofertas completo" en MOVO-183, un aviso explícito en vez de navegar
    // a una ruta inventada.
    Alert.alert("Muy pronto", `Esta acción todavía no está lista (${cta.destination}).`);
  };

  const content = (
    <View style={{ padding: 20, gap: 4 }}>
      {/* ── Encabezado: código (headline) + contraparte, pill de estado a la derecha ── */}
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-mono-semibold text-[25px] text-fg" numberOfLines={1}>
            {activeShipmentDisplayCode(shipment.id)}
          </Text>
          <Text className="font-sans-medium text-small text-fg-2">
            {activeShipmentSubtitle(shipment)}
          </Text>
        </View>
        <View
          // El pill del estado en la card "flat" (`assigned_unfunded`) apenas se
          // distinguía del fondo (`bg-bg-mute` sobre `bg-bg-sub`, casi el mismo tono
          // — feedback del usuario, "el pill actual no se diferencia del fondo, es
          // muy clarito") — un borde explícito lo separa sin depender del contraste
          // de relleno, que en dark mode es igual de parecido entre ambos tokens.
          className={`flex-none flex-row items-center gap-1.5 self-start rounded-full border px-3 ${isUnfunded ? "border-border-strong bg-bg-mute" : "border-transparent"}`}
          style={{ height: 31, backgroundColor: isUnfunded ? undefined : colors.activeCardPillBg }}
        >
          {shipment.status === "in_transit" ? (
            <View className="h-1.5 w-1.5 rounded-full bg-fg" />
          ) : null}
          <Text className="font-sans-semibold text-caption text-fg">
            {activeShipmentStatusLabel(shipment)}
          </Text>
        </View>
      </View>

      {/* El chip "Hoy" suelto se reemplazó por el subtítulo del encabezado
          ("Nicolás Vera retira hoy"/"retira mañana", `activeShipmentSubtitle`) —
          feedback del usuario. "Ventana vencida" sigue siendo un chip aparte: no
          hay una palabra corta tipo "hoy"/"mañana" para meterla en la misma frase. */}
      {shipment.pickupWindowExpired ? (
        <View className="flex-row flex-wrap gap-1.5 pt-1.5">
          <View className="rounded-full bg-danger-500 px-2.5 py-1">
            <Text className="font-sans-semibold text-caption uppercase text-paper">
              Ventana vencida
            </Text>
          </View>
        </View>
      ) : null}

      {/* ── Stepper de 4 pasos fijos — nodos y barras son hermanos en flujo normal
          (nunca superpuestos): la barra vive en el espacio ENTRE dos columnas de
          nodo, no dentro de una columna con offset negativo, para no depender del
          orden de pintado entre hermanos como sí importa en RN. ── */}
      <View className="flex-row items-start pb-0.5 pt-5">
        {ACTIVE_SHIPMENT_STEPS.map((label, index) => {
          const Icon = STEP_ICONS[index];
          const done = index < activeIndex;
          const current = index === activeIndex;
          const pulsing = current && index === 1;
          // `done`/`current` son un par blanco+negro FIJO (nunca invertido con el
          // tema) — el nodo "actual" siempre es un círculo blanco con ícono negro,
          // así que su contraste interno no depende de si la card de alrededor es
          // clara u oscura. El resto (nodo "hecho" y el color de barra/label de los
          // pasos ya alcanzados) sí necesita adaptarse: en la card oscura, "#0A0A0B"
          // fijo se volvía invisible contra un fondo casi del mismo tono (bug
          // reportado por el usuario, sin variante de dark mode hasta este fix).
          //
          // El nodo "actual" con sombra/`elevation` nunca convive con `pulsing`:
          // Android promueve una view con `elevation` a su propia capa compuesta y
          // la reordena por encima de sus hermanas sin `elevation` propia, sin
          // importar el orden real del árbol — tapaba por completo el halo pulsante
          // (un sibling absoluto detrás, sin `elevation`), no solo donde se
          // superponen literalmente (bug reportado por el usuario: "no hay ningún
          // halo, ni estático ni animado"). El halo de por sí es mucho más
          // elocuente que esa sombra chica, así que acá se saca directamente.
          const nodeStyle = done
            ? { backgroundColor: colors.fg1 }
            : current
              ? isUnfunded
                ? { backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#0A0A0B" }
                : pulsing
                  ? { backgroundColor: "#FFFFFF" }
                  : {
                      backgroundColor: "#FFFFFF",
                      shadowColor: colors.chromeShadow,
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 1,
                      shadowRadius: 3,
                      elevation: 2,
                    }
              : { backgroundColor: isUnfunded ? colors.bgMute : colors.activeCardStepFutureBg };
          const iconColor = done ? colors.bg : current ? "#0A0A0B" : colors.fg3;
          const barColor = index <= activeIndex ? colors.fg1 : colors.borderStrong;
          const labelColor = index <= activeIndex ? colors.fg1 : colors.fg3;

          return (
            <Fragment key={label}>
              {index > 0 ? (
                <View style={{ flex: 1, height: 3, marginTop: 17.5, borderRadius: 999, backgroundColor: barColor }} />
              ) : null}
              {/* Columna de ancho FIJO (igual al círculo, no al contenido) — si el
                  label mide más que el ícono, un ancho automático corre el círculo
                  del borde de la columna y la barra conectora (que sí llega hasta
                  ese borde) queda con un hueco visible antes de tocarlo. El círculo
                  queda siempre pegado a la barra gracias a este ancho fijo. */}
              <View style={{ width: STEP_NODE_SIZE, alignItems: "center", gap: 8 }}>
                <View style={{ width: STEP_NODE_SIZE, height: STEP_NODE_SIZE, alignItems: "center", justifyContent: "center" }}>
                  {pulsing ? <PulsingStepRing color={colors.fg1} /> : null}
                  <View
                    style={[
                      { width: STEP_NODE_SIZE, height: STEP_NODE_SIZE, borderRadius: 999, alignItems: "center", justifyContent: "center" },
                      nodeStyle,
                    ]}
                  >
                    <Icon size={17} strokeWidth={2} color={iconColor} />
                  </View>
                </View>
                {/* Ancho explícito (no `flexShrink`, que solo afecta el eje
                    principal — vertical acá, ya que la columna es `flexDirection:
                    "column"` por default): sin un ancho propio, Yoga mide este
                    `Text` acotado al ancho de la columna (38px, el del ícono) y lo
                    trunca con "…" — "En camino"/"Llegando" no entran ahí. Con un
                    ancho fijo más generoso, Yoga deja de recortarlo a su medida y
                    lo centra desbordando la columna angosta, sin afectar el resto
                    del layout (la columna sigue midiendo 38px para la barra). */}
                <Text
                  numberOfLines={1}
                  style={{ color: labelColor, width: STEP_LABEL_WIDTH, textAlign: "center" }}
                  className={`text-[11.5px] ${current ? "font-sans-semibold" : "font-sans-medium"}`}
                >
                  {label}
                </Text>
              </View>
            </Fragment>
          );
        })}
      </View>

      {/* ── Retiro / Entrega, dos columnas — alineadas arriba: sin dato de horario
          de entrega en el contrato (AC5 de MOVO-192 solo trae ventana de retiro),
          la columna "Entrega" tiene una línea menos que "Retiro" — alinear por abajo
          (como antes) dejaba el domicilio de entrega pegado contra el horario de
          retiro en vez de contra su propio eyebrow/domicilio. ── */}
      <View className="flex-row items-start justify-between gap-3 pt-5">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-sans-semibold text-caption uppercase text-fg-3">Retiro</Text>
          <Text numberOfLines={1} className="font-sans-semibold text-small text-fg">
            {shortAddressLabel(shipment.pickupAddress)}
          </Text>
          <Text className="font-mono text-caption text-fg-3">
            {formatPickupWindowLabel(shipment.pickupTimeWindowStart, shipment.pickupTimeWindowEnd)}
          </Text>
        </View>
        <View className="min-w-0 flex-1 items-end gap-0.5">
          <Text className="font-sans-semibold text-caption uppercase text-fg-3">Entrega</Text>
          <Text numberOfLines={1} className="text-right font-sans-semibold text-small text-fg">
            {shortAddressLabel(shipment.deliveryAddress)}
          </Text>
        </View>
      </View>

      {/* ── Fila inferior: texto + acción ── */}
      <View
        className={`flex-row items-center gap-3 pt-4 ${isUnfunded ? "border-t border-border" : ""}`}
        style={{ marginTop: 12, borderTopWidth: isUnfunded ? undefined : 1, borderTopColor: isUnfunded ? undefined : colors.activeCardFooterBorder }}
      >
        <Text className="flex-1 font-sans-medium text-small text-fg-2">
          {activeShipmentFooterText(role, shipment)}
        </Text>
        {cta ? (
          <Pressable
            testID={testID ? `${testID}-cta` : undefined}
            onPress={handleCta}
            className={`h-[38px] flex-none items-center justify-center rounded-full px-4 ${cta.variant === "secondary" ? "bg-fg" : "bg-lime-500"}`}
          >
            <Text
              className={`font-sans-semibold text-small ${cta.variant === "secondary" ? "text-bg" : "text-ink-950"}`}
            >
              {cta.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  if (isUnfunded) {
    return (
      <View
        testID={testID}
        className="mb-3 rounded-[22px] border border-border bg-bg-sub"
        style={{
          shadowColor: colors.chromeShadow,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 2,
          elevation: 1,
        }}
      >
        {content}
      </View>
    );
  }

  return (
    // La sombra vive en este `View` de afuera, NUNCA en el `style` de
    // `GradientBorderCard` (probado: subir alfa/radio/offset ahí no cambiaba nada
    // en pantalla) — su borde exterior es un `<LinearGradient>` de
    // `expo-linear-gradient`, y esa librería fija `masksToBounds = true` en la
    // capa raíz de su vista nativa en iOS (`LinearGradientLayer.swift`, siempre,
    // no depende de `borderRadius`/`overflow`). Una capa con `masksToBounds` no
    // puede dibujar su propia sombra fuera de sus bordes recortados — cualquier
    // `shadow*` puesto ahí queda invisible sin importar el valor. Un `View` común
    // no tiene esa restricción.
    <View
      style={{
        marginBottom: 12,
        borderRadius: 22,
        backgroundColor: colors.chromeGradient[0],
        shadowColor: colors.activeCardShadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 10,
        // Android dibuja la sombra de `elevation` con su propio algoritmo,
        // bastante menos sensible al alfa de `shadowColor` que iOS — bajar
        // solo el alfa (ver `activeCardShadow`) no alcanzaba ahí. 14 se sentía
        // "MUY fuerte" en varias rondas de feedback.
        elevation: 4,
      }}
    >
      <GradientBorderCard
        testID={testID}
        fillColors={colors.chromeGradient}
        borderColors={colors.chromeBorderGradient}
        borderRadius={22}
        borderWidth={1}
      >
        {content}
      </GradientBorderCard>
    </View>
  );
}
