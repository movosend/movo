import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp, Users } from "lucide-react-native";
import type { MutualConnections } from "@movo/shared/dist/types/user-profile";
import { MutualConnectionsSummary } from "../profile/mutual-connections-row";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/**
 * Sección de `DevShortcutsScreen` (solo __DEV__) para ver cómo queda "Ya hizo envíos con N personas
 * que vos también conocés" (MOVO-174) sin depender del backend ni de tener envíos entregados con una
 * contraparte en común. Renderiza el mismo componente visual del perfil público
 * (`MutualConnectionsSummary`) con datos de prueba.
 *
 * Los ejemplos van en un desplegable (cerrado por defecto) para no alargar la pantalla de atajos.
 * Todos son "solo conteo": el backend manda siempre `sampleFirstNames` vacío (decisión de
 * privacidad), así que no se muestran variantes con nombres. En la app real la fila está en el hero
 * del perfil, debajo de las verificaciones.
 */
const VARIANTS: { id: string; label: string; data: MutualConnections }[] = [
  { id: "zero", label: "0 conexiones (no se muestra nada)", data: { totalCount: 0, sampleFirstNames: [] } },
  { id: "one", label: "1 conexión — 1 anillo", data: { totalCount: 1, sampleFirstNames: [] } },
  { id: "two", label: "2 conexiones — 2 anillos", data: { totalCount: 2, sampleFirstNames: [] } },
  { id: "three", label: "3 conexiones — 3 anillos (máximo)", data: { totalCount: 3, sampleFirstNames: [] } },
  { id: "huge", label: "150 conexiones — se muestra 99+", data: { totalCount: 150, sampleFirstNames: [] } },
];

export function DevMutualConnectionsSection() {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <View className="mb-6 rounded-[16px] border border-border bg-bg-sub p-4">
      <Pressable
        testID="dev-mutual-toggle"
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Conexiones mutuas, mostrar u ocultar ejemplos"
        className="flex-row items-center gap-2"
      >
        <View className="h-8 w-8 items-center justify-center rounded-full bg-blue-500/15">
          <Users size={16} color="#3B82F6" />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[15px] text-fg">Conexiones mutuas (MOVO-174)</Text>
          <Text className="font-sans text-[11px] text-fg-3">
            {expanded ? "Ocultar ejemplos" : `Ver ${VARIANTS.length} ejemplos`}
          </Text>
        </View>
        <Chevron size={18} color={colors.fg2} strokeWidth={2} />
      </Pressable>

      {expanded ? (
        <View className="mt-3 gap-3">
          {VARIANTS.map(({ id, label, data }) => (
            <View key={id} className="gap-1.5 rounded-[12px] border border-border bg-bg px-4 py-3">
              <Text className="font-sans-medium text-[11px] uppercase text-fg-3">{label}</Text>
              {data.totalCount === 0 ? (
                <Text testID={`dev-mutual-${id}-empty`} className="font-sans text-[12px] italic text-fg-3">
                  (la fila no se renderiza)
                </Text>
              ) : (
                <MutualConnectionsSummary connections={data} testID={`dev-mutual-${id}`} />
              )}
            </View>
          ))}

          <Text className="text-center font-sans text-[11px] text-fg-3">
            En la app real aparece en el perfil de otra persona, debajo de las verificaciones. Nunca en el
            perfil propio.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
