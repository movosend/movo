import { Flag, MapPin, Package, Route } from "lucide-react-native";
import { Fragment } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { ActiveShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  ACTIVE_SHIPMENT_STEPS,
  activeShipmentCta,
  activeShipmentDisplayCode,
  activeShipmentFooterText,
  activeShipmentStatusLabel,
  activeShipmentStepIndex,
  type ActiveShipmentRole,
} from "../../src/lib/active-shipment-format";
import { formatPickupWindowLabel, shortAddressLabel } from "../../src/lib/shipment-format";
import { GradientBorderCard } from "../ui/gradient-border-card";

const STEP_ICONS = [MapPin, Route, Package, Flag];

/** Colores fuera de la escala de tokens del repo, tomados 1:1 del `skin()` de "Home
 * operativo v2.dc.html" (Claude Design) — el resto de la card sí usa los tokens
 * (`ink`/`lime`/`bg-mute`/`border`) de `tailwind.config.js`. */
const CHROME = {
  fill: ["#F2F2F2", "#D8D8D8", "#C2C2C2"] as [string, string, string],
  border: ["#FFFFFF", "#C7C7CE"] as [string, string],
  stepFutureBg: "rgba(255,255,255,0.55)",
  stepFutureIcon: "#4A4A52",
  labelFuture: "#3F3F46",
  barFuture: "rgba(10,10,11,0.18)",
};

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
          <Text numberOfLines={1} className="font-sans-medium text-small text-fg-2">
            {shipment.counterparty.name}
          </Text>
        </View>
        <View
          className="flex-none flex-row items-center gap-1.5 self-start rounded-full px-3"
          style={{ height: 31, backgroundColor: isUnfunded ? "#F1F1F3" : "rgba(255,255,255,0.70)" }}
        >
          {shipment.status === "in_transit" ? (
            <View className="h-1.5 w-1.5 rounded-full bg-ink-950" />
          ) : null}
          <Text className="font-sans-semibold text-caption text-fg">
            {activeShipmentStatusLabel(shipment.status)}
          </Text>
        </View>
      </View>

      {shipment.isToday || shipment.pickupWindowExpired ? (
        <View className="flex-row flex-wrap gap-1.5 pt-1.5">
          {shipment.isToday ? (
            <View className="rounded-full bg-lime-500 px-2.5 py-1">
              <Text className="font-sans-semibold text-caption uppercase text-ink-950">Hoy</Text>
            </View>
          ) : null}
          {shipment.pickupWindowExpired ? (
            <View className="rounded-full bg-danger-500 px-2.5 py-1">
              <Text className="font-sans-semibold text-caption uppercase text-paper">
                Ventana vencida
              </Text>
            </View>
          ) : null}
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
          const nodeStyle = done
            ? { backgroundColor: "#0A0A0B" }
            : current
              ? isUnfunded
                ? { backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: "#0A0A0B" }
                : {
                    backgroundColor: "#FFFFFF",
                    shadowColor: colors.chromeShadow,
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 1,
                    shadowRadius: 3,
                    elevation: 2,
                  }
              : { backgroundColor: isUnfunded ? "#F1F1F3" : CHROME.stepFutureBg };
          const iconColor = done ? "#FFFFFF" : current ? "#0A0A0B" : isUnfunded ? "#B4B4BC" : CHROME.stepFutureIcon;
          const barColor = index <= activeIndex ? "#0A0A0B" : isUnfunded ? "#E6E6EA" : CHROME.barFuture;
          const labelColor = index <= activeIndex ? "#0A0A0B" : isUnfunded ? "#A8A8B0" : CHROME.labelFuture;

          return (
            <Fragment key={label}>
              {index > 0 ? (
                <View style={{ flex: 1, height: 3, marginTop: 17.5, borderRadius: 999, backgroundColor: barColor }} />
              ) : null}
              <View className="items-center gap-2">
                <View
                  style={[{ width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" }, nodeStyle]}
                >
                  <Icon size={17} strokeWidth={2} color={iconColor} />
                </View>
                <Text
                  numberOfLines={1}
                  style={{ color: labelColor }}
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
        className="flex-row items-center gap-3 pt-4"
        style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: isUnfunded ? "#EDEDF0" : "rgba(10,10,11,0.14)" }}
      >
        <Text numberOfLines={1} className="flex-1 font-sans-medium text-small text-fg-2">
          {activeShipmentFooterText(role, shipment)}
        </Text>
        {cta ? (
          <Pressable
            testID={testID ? `${testID}-cta` : undefined}
            onPress={handleCta}
            className="h-[38px] flex-none items-center justify-center rounded-full bg-lime-500 px-4"
          >
            <Text className="font-sans-semibold text-small text-ink-950">{cta.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  if (isUnfunded) {
    return (
      <View
        testID={testID}
        className="mb-3 rounded-[22px] bg-bg-sub"
        style={{
          borderWidth: 1,
          borderColor: "#E2E2E7",
          shadowColor: "#0A0A0B",
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
    <GradientBorderCard
      testID={testID}
      fillColors={CHROME.fill}
      borderColors={CHROME.border}
      borderRadius={22}
      borderWidth={1}
      style={{
        marginBottom: 12,
        // `backgroundColor` explícito, no solo el gradiente: sin esto, iOS no
        // encuentra una forma opaca de la que calcular la sombra y no la dibuja —
        // el bug reportado ("la card metálica no se ve elevada"). El color no se ve
        // (el gradiente lo cubre por completo), solo habilita la sombra.
        backgroundColor: CHROME.fill[0],
        shadowColor: colors.chromeShadow,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 20,
        elevation: 6,
      }}
    >
      {content}
    </GradientBorderCard>
  );
}
