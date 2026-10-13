import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as Notifications from "expo-notifications";
import { BellRing, ChevronDown, ChevronUp } from "lucide-react-native";
import { resolveNotificationRoute } from "../../src/hooks/use-push-notifications";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/** Segundos de espera: dan tiempo a mandar la app a segundo plano o cerrarla del todo. */
export const DEV_PUSH_DELAY_SECONDS = 10;

type IdField = "shipmentId" | "offerId" | "tripId" | "transferId";
type Ids = Record<IdField, string>;

/** Un ejemplo por `data.type` que manda el backend (MOVO-281/MOVO-240). Los ids salen de los
 * campos de arriba, así el payload apunta a datos reales de la cuenta. */
const EXAMPLES: { label: string; build: (ids: Ids) => Record<string, string> }[] = [
  { label: "Envío cancelado (bug de MOVO-240)", build: ({ shipmentId }) => ({ type: "shipment_cancelled", shipmentId }) },
  { label: "Receptor aceptó", build: ({ shipmentId }) => ({ type: "shipment_accepted", shipmentId }) },
  { label: "Receptor rechazó", build: ({ shipmentId }) => ({ type: "shipment_rejected", shipmentId }) },
  { label: "Oferta nueva", build: ({ shipmentId, offerId }) => ({ type: "offer_created", shipmentId, offerId }) },
  { label: "Oferta desplazada", build: ({ shipmentId, offerId }) => ({ type: "offer_superseded", shipmentId, offerId }) },
  { label: "Oferta rechazada", build: ({ shipmentId, offerId }) => ({ type: "offer_rejected", shipmentId, offerId }) },
  { label: "Oferta anulada", build: ({ shipmentId, offerId }) => ({ type: "offer_voided", shipmentId, offerId }) },
  { label: "Retiro confirmado", build: ({ shipmentId }) => ({ type: "custody_pickup_confirmed", shipmentId }) },
  { label: "Entrega confirmada", build: ({ shipmentId }) => ({ type: "custody_delivery_confirmed", shipmentId }) },
  { label: "Salió de viaje", build: ({ shipmentId, tripId }) => ({ type: "trip_started", shipmentId, tripId }) },
  { label: "Calificación pendiente", build: ({ shipmentId }) => ({ type: "rating_pending", shipmentId }) },
  { label: "Transportista cerca", build: ({ shipmentId }) => ({ type: "carrier_nearby", shipmentId }) },
  { label: "Paquete compatible", build: ({ shipmentId, tripId }) => ({ type: "trip_match", tripId, shipmentId }) },
  { label: "Recordatorio de viaje", build: ({ tripId }) => ({ type: "trip_reminder", tripId }) },
  { label: "Viaje auto-creado", build: ({ tripId }) => ({ type: "trip_auto_created", tripId }) },
  { label: "Invitación a recibir", build: ({ transferId, shipmentId }) => ({ type: "receiver_transfer_invite", transferId, shipmentId }) },
  { label: "KYC identidad aprobada", build: () => ({ type: "kyc_result", verificationType: "identity", status: "approved" }) },
  { label: "KYC identidad rechazada", build: () => ({ type: "kyc_result", verificationType: "identity", status: "rejected" }) },
  { label: "KYC licencia rechazada", build: () => ({ type: "kyc_result", verificationType: "license", status: "rejected" }) },
  { label: "KYC en revisión manual", build: () => ({ type: "kyc_result", verificationType: "license", status: "manual_review" }) },
  { label: "Cambio de contraseña", build: () => ({ type: "account_password_changed" }) },
];

const ID_FIELDS: { key: IdField; label: string }[] = [
  { key: "shipmentId", label: "shipmentId" },
  { key: "offerId", label: "offerId" },
  { key: "tripId", label: "tripId" },
  { key: "transferId", label: "transferId" },
];

function routeLabel(data: Record<string, string>): string | null {
  const route = resolveNotificationRoute(data);
  if (!route) return null;
  return typeof route === "string" ? route : `${route.pathname}?${new URLSearchParams(route.params).toString()}`;
}

/**
 * Sección de `DevShortcutsScreen` (solo __DEV__) para probar la navegación al tocar una
 * notificación (MOVO-281) sin push remota: programa una notificación LOCAL con el mismo
 * `data` que manda el backend. Al tocarla pasa por el mismo `handleNotificationResponse`
 * que una push real (foreground, background y cold start). Las notificaciones locales no
 * necesitan la capability de push de iOS, así que anda con `ENABLE_PUSH_NOTIFICATIONS=false`.
 */
export function DevPushRoutingSection() {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const [ids, setIds] = useState<Ids>({ shipmentId: "", offerId: "", tripId: "", transferId: "" });
  const [status, setStatus] = useState<string | null>(null);
  const Chevron = expanded ? ChevronUp : ChevronDown;

  const schedule = async (label: string, data: Record<string, string>) => {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && !(await Notifications.requestPermissionsAsync()).granted) {
      setStatus("Sin permiso de notificaciones: habilitalo en Ajustes.");
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: `Prueba: ${label}`, body: `data.type = ${data.type}`, data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: DEV_PUSH_DELAY_SECONDS },
    });
    setStatus(`"${label}" llega en ${DEV_PUSH_DELAY_SECONDS} s.`);
  };

  return (
    <View className="mb-6 rounded-[16px] border border-border bg-bg-sub p-4">
      <Pressable
        testID="dev-push-toggle"
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Navegación de notificaciones, mostrar u ocultar"
        className="flex-row items-center gap-2"
      >
        <View className="h-8 w-8 items-center justify-center rounded-full bg-blue-500/15">
          <BellRing size={16} color="#3B82F6" />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[15px] text-fg">Navegación de notificaciones (MOVO-281)</Text>
          <Text className="font-sans text-[11px] text-fg-3">
            Notificación local a {DEV_PUSH_DELAY_SECONDS} s: probala abierta, en segundo plano o cerrada
          </Text>
        </View>
        <Chevron size={18} color={colors.fg2} strokeWidth={2} />
      </Pressable>

      {expanded ? (
        <View className="mt-3 gap-3">
          <View className="gap-2">
            {ID_FIELDS.map(({ key, label }) => (
              <TextInput
                key={key}
                testID={`dev-push-id-${key}`}
                value={ids[key]}
                onChangeText={(value) => setIds((prev) => ({ ...prev, [key]: value.trim() }))}
                placeholder={label}
                placeholderTextColor={colors.fg3}
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-[10px] border border-border bg-bg px-3 py-2 font-mono text-[12px] text-fg"
              />
            ))}
          </View>

          {status ? (
            <Text testID="dev-push-status" className="font-sans text-[12px] text-lime-500">
              {status}
            </Text>
          ) : null}

          {EXAMPLES.map(({ label, build }) => {
            const data = build(ids);
            const route = routeLabel(data);
            return (
              <Pressable
                key={label}
                testID={`dev-push-${label}`}
                disabled={!route}
                onPress={() => void schedule(label, data)}
                className={`rounded-[12px] border border-border bg-bg px-4 py-3 ${route ? "" : "opacity-40"}`}
              >
                <Text className="font-sans-medium text-[13px] text-fg">{label}</Text>
                <Text className="font-mono text-[11px] text-fg-3" numberOfLines={1}>
                  {route ? `→ ${route}` : "Falta un id para armar la ruta"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
