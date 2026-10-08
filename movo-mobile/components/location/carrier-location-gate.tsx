import { Check, Navigation, Settings } from "lucide-react-native";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CARRIER_LOCATION_REQUIREMENTS,
  isRequirementMet,
  type CarrierLocationReadiness,
  type CarrierLocationRequirement,
} from "../../src/lib/carrier-location-readiness";

interface RequirementCopy {
  label: string;
  /** Qué tiene que hacer el usuario, por plataforma: los diálogos y los nombres de
   * las opciones son distintos en iOS y Android. */
  howTo: { ios: string; android: string };
  actionLabel: string;
}

const REQUIREMENT_COPY: Record<CarrierLocationRequirement, RequirementCopy> = {
  services: {
    label: "GPS del teléfono",
    howTo: {
      ios: "Está apagado. Activalo en Ajustes › Privacidad y seguridad › Localización.",
      android: "Está apagado. Tocá el botón y aceptá activar la ubicación.",
    },
    actionLabel: "Activar GPS",
  },
  foreground: {
    label: "Ubicación de Movo",
    howTo: {
      ios: "Permití que Movo use tu ubicación.",
      android: "Permití que Movo use tu ubicación.",
    },
    actionLabel: "Activar ubicación",
  },
  precise: {
    label: "Ubicación exacta",
    howTo: {
      ios: "En Ajustes › Movo › Ubicación, activá «Ubicación exacta». Con la aproximada no podemos validar las entregas.",
      android: "Elegí «Precisa» cuando te lo pregunte. Con la aproximada no podemos validar las entregas.",
    },
    actionLabel: "Activar ubicación exacta",
  },
  background: {
    label: "Ubicación en segundo plano",
    howTo: {
      ios: "Elegí «Cambiar a Permitir siempre». Si no aparece, entrá a Ajustes › Movo › Ubicación y marcá «Siempre».",
      android: "En la pantalla que se abre, entrá a Ubicación y elegí «Permitir todo el tiempo».",
    },
    actionLabel: "Permitir en segundo plano",
  },
};

interface CarrierLocationGateProps {
  visible: boolean;
  readiness: CarrierLocationReadiness | null;
  missing: CarrierLocationRequirement | null;
  needsSettings: boolean;
  pending: boolean;
  onResolve: () => void;
  /** Sin `onDismiss` la pantalla no tiene salida: es el caso de un viaje en curso. */
  onDismiss?: () => void;
}

/**
 * Pantalla de acceso a la ubicación en segundo plano para operar como transportista
 * (`carrier-location-readiness.ts`) — presentacional pura, la decide
 * `CarrierLocationGateMount` en `app/_layout.tsx`.
 *
 * Mismo lenguaje visual que `RequiredPermissionsGate` (`bg-ink-950` fijo): es la
 * continuación de la misma conversación de permisos, para quien además transporta.
 * Muestra los cuatro requisitos como checklist y explica solo el que falta, con las
 * instrucciones de la plataforma: en Android 11+ y en iOS la opción "siempre" no está
 * en el primer diálogo, así que sin decir dónde tocar la tasa de aceptación cae.
 */
export function CarrierLocationGate({
  visible,
  readiness,
  missing,
  needsSettings,
  pending,
  onResolve,
  onDismiss,
}: CarrierLocationGateProps) {
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const current = missing ? REQUIREMENT_COPY[missing] : null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => onDismiss?.()}
    >
      <SafeAreaView className="flex-1 bg-ink-950" edges={["top", "bottom"]}>
        <ScrollView
          contentContainerClassName="grow justify-between gap-8 px-6 py-8"
          testID="carrier-location-gate"
        >
          <View className="gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-ink-800">
              <Navigation size={24} color="#C6F24A" strokeWidth={2} />
            </View>
            <Text className="font-sans-semibold text-[28px] leading-[32px] tracking-[-0.5px] text-paper">
              Para transportar, Movo necesita tu ubicación todo el tiempo
            </Text>
            <Text className="font-sans text-[15px] leading-[21px] text-ink-400">
              Mientras tengas un viaje en curso, quien envía y quien recibe siguen tu
              avance en el mapa. Si la ubicación se corta al apagar la pantalla o abrir
              otra app de navegación, el seguimiento se pausa.
            </Text>
          </View>

          <View className="gap-2">
            {CARRIER_LOCATION_REQUIREMENTS.map((requirement) => {
              const met = readiness ? isRequirementMet(readiness, requirement) : false;
              const isCurrent = requirement === missing;
              const copy = REQUIREMENT_COPY[requirement];
              return (
                <View
                  key={requirement}
                  testID={`carrier-location-requirement-${requirement}`}
                  className={`gap-2 rounded-2xl border p-4 ${
                    isCurrent ? "border-lime-500/40 bg-ink-800" : "border-white/[0.06] bg-ink-900"
                  }`}
                >
                  <View className="flex-row items-center gap-3">
                    <View
                      className={`h-6 w-6 items-center justify-center rounded-full ${
                        met ? "bg-lime-500" : "border border-ink-600"
                      }`}
                    >
                      {met ? <Check size={14} color="#0A0A0B" strokeWidth={3} /> : null}
                    </View>
                    <Text
                      testID={`carrier-location-requirement-${requirement}-${met ? "met" : "missing"}`}
                      className={`flex-1 font-sans-semibold text-small ${
                        met ? "text-ink-400" : "text-paper"
                      }`}
                    >
                      {copy.label}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <Text className="pl-9 font-sans text-[13px] leading-[18px] text-ink-300">
                      {copy.howTo[platform]}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          <View className="gap-3">
            {current ? (
              <Pressable
                testID="carrier-location-gate-action"
                disabled={pending}
                onPress={onResolve}
                style={{ opacity: pending ? 0.8 : 1 }}
                className="h-14 flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 active:opacity-80"
              >
                {pending ? <ActivityIndicator color="#0A0A0B" /> : null}
                {needsSettings && !pending ? (
                  <Settings size={16} color="#0A0A0B" strokeWidth={2} />
                ) : null}
                <Text className="font-sans-semibold text-body text-ink-950">
                  {needsSettings ? "Abrir Ajustes" : current.actionLabel}
                </Text>
              </Pressable>
            ) : null}
            {onDismiss ? (
              <Pressable
                testID="carrier-location-gate-dismiss"
                disabled={pending}
                onPress={onDismiss}
                className="h-12 items-center justify-center rounded-lg"
              >
                <Text className="font-sans-medium text-body text-ink-300">Ahora no</Text>
              </Pressable>
            ) : null}
            <Text className="text-center font-sans text-[13px] leading-[18px] text-ink-500">
              Solo la usamos mientras tengas un viaje en curso. Cuando lo terminás, Movo
              deja de seguir tu ubicación.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
