import { Camera as CameraIcon, MapPin, Settings, ShieldAlert } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  REQUIRED_PERMISSION_COPY,
  type RequiredPermissionKind,
  type RequiredPermissionsSnapshot,
} from "../../src/lib/required-permissions";

const ICONS: Record<RequiredPermissionKind, LucideIcon> = {
  location: MapPin,
  camera: CameraIcon,
};

interface RequiredPermissionsGateProps {
  visible: boolean;
  missing: RequiredPermissionKind[];
  statuses: RequiredPermissionsSnapshot | null;
  pendingKind: RequiredPermissionKind | null;
  onRequest: (kind: RequiredPermissionKind) => void;
  onOpenSettings: () => void;
}

/**
 * Pantalla bloqueante de permisos obligatorios (`required-permissions.ts`) —
 * presentacional pura, la decide `use-required-permissions-gate.ts`.
 *
 * Deliberadamente **sin ninguna salida**: no tiene botón de cerrar, el backdrop no
 * cierra nada y `onRequestClose` es un no-op para tragarse también el botón físico
 * de Android. Mismo criterio que el gate de Términos y Condiciones obligatorios
 * (`profile/legal/index.tsx`, MOVO-244), pero un escalón más duro — ahí se bloquea
 * una pantalla, acá la app entera.
 *
 * El lenguaje visual es el de los pasos de permiso del carrusel de onboarding
 * (`bg-ink-950` fijo, no theme-aware): es literalmente la misma conversación, vista
 * por segunda vez.
 */
export function RequiredPermissionsGate({
  visible,
  missing,
  statuses,
  pendingKind,
  onRequest,
  onOpenSettings,
}: RequiredPermissionsGateProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // No-op a propósito: el back de Android no puede saltear este gate.
      }}
    >
      <SafeAreaView className="flex-1 bg-ink-950" edges={["top", "bottom"]}>
        <ScrollView
          contentContainerClassName="grow justify-between gap-8 px-6 py-8"
          testID="required-permissions-gate"
        >
          <View className="gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-ink-800">
              <ShieldAlert size={24} color="#C6F24A" strokeWidth={2} />
            </View>
            <Text className="font-sans-semibold text-[28px] leading-[32px] tracking-[-0.5px] text-paper">
              Movo necesita estos permisos para funcionar
            </Text>
            <Text className="font-sans text-[15px] leading-[21px] text-ink-400">
              No son opcionales: sin ellos no podemos confirmar la entrega de un paquete
              ni registrar en qué estado viajó. Activalos para seguir.
            </Text>
          </View>

          <View className="gap-3">
            {missing.map((kind) => {
              const copy = REQUIRED_PERMISSION_COPY[kind];
              const Icon = ICONS[kind];
              // `canAskAgain: false` = el SO ya no vuelve a mostrar el diálogo. Volver
              // a llamar al request ahí no haría nada visible: el único camino es Ajustes.
              const blockedBySystem = statuses ? !statuses[kind].canAskAgain : false;
              const isPending = pendingKind === kind;

              return (
                <View
                  key={kind}
                  testID={`required-permission-card-${kind}`}
                  className="gap-3.5 rounded-2xl border border-white/[0.06] bg-ink-800 p-4"
                >
                  <View className="flex-row items-start gap-3">
                    <View className="h-9 w-9 items-center justify-center rounded-lg bg-ink-700">
                      <Icon size={18} color="#fff" strokeWidth={2} />
                    </View>
                    <View className="flex-1 gap-1">
                      <Text className="font-sans-semibold text-small text-paper">{copy.label}</Text>
                      <Text className="font-sans text-[13px] leading-[18px] text-ink-400">
                        {copy.why}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    testID={`required-permission-action-${kind}`}
                    disabled={isPending}
                    onPress={() => (blockedBySystem ? onOpenSettings() : onRequest(kind))}
                    style={{ opacity: isPending ? 0.8 : 1 }}
                    className="h-12 flex-row items-center justify-center gap-2 rounded-lg bg-paper active:opacity-80"
                  >
                    {isPending ? <ActivityIndicator color="#0A0A0B" /> : null}
                    {blockedBySystem && !isPending ? (
                      <Settings size={16} color="#0A0A0B" strokeWidth={2} />
                    ) : null}
                    <Text className="font-sans-semibold text-body text-ink-950">
                      {blockedBySystem ? "Abrir Ajustes" : copy.grantLabel}
                    </Text>
                  </Pressable>

                  {blockedBySystem ? (
                    <Text
                      testID={`required-permission-blocked-${kind}`}
                      className="font-sans text-[13px] leading-[18px] text-ink-400"
                    >
                      Lo rechazaste antes, así que el sistema ya no vuelve a preguntar.
                      Activalo desde Ajustes y volvé a Movo.
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          <Text className="font-sans text-[13px] leading-[18px] text-ink-500">
            Movo usa tu ubicación solo mientras la app está abierta, y nunca accede a
            tu cámara por su cuenta. Podés revisar el detalle en la Política de
            Privacidad.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
