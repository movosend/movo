import type { LucideIcon } from "lucide-react-native";
import { EyeOff, Handshake, Info, Truck, Undo2, UserRound } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface Implication {
  Icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * Qué implica un bloqueo en Movo (MOVO-175, ADR-026). Cada fila describe una regla
 * que el backend efectivamente aplica — no agregar una promesa acá sin que exista del
 * lado de `svc-users`/`svc-shipments`.
 */
const IMPLICATIONS: Implication[] = [
  {
    Icon: EyeOff,
    title: "No se ven en los listados",
    description:
      "Ninguno de los dos ve los envíos del otro en Transportar ni lo encuentra al buscar un receptor. Aplica en las dos direcciones.",
  },
  {
    Icon: Handshake,
    title: "No hay nuevas interacciones",
    description:
      "No pueden ofertar sobre los envíos del otro, aceptar sus ofertas pendientes ni designarse como receptor. Si lo intentan, Movo les avisa que hay un bloqueo.",
  },
  {
    Icon: Truck,
    title: "Lo que está en curso sigue",
    description: "Los envíos que ya tenían asignados entre ustedes no se cancelan: se completan normalmente.",
  },
  {
    Icon: UserRound,
    title: "Los perfiles siguen visibles",
    description: "El perfil es público en Movo, así que la otra persona todavía puede verlo.",
  },
  {
    Icon: Undo2,
    title: "Es reversible",
    description: "Podés desbloquear cuando quieras desde esta pantalla o desde su perfil.",
  },
];

export function BlockImplicationsCard({ testID = "block-implications-card" }: { testID?: string }) {
  const colors = useThemeColors();

  return (
    <View testID={testID} className="overflow-hidden rounded-[10px] border border-border bg-bg-sub">
      <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
        <Info size={16} strokeWidth={1.8} color={colors.fg2} />
        <Text className="font-sans-semibold text-[14px] text-fg">Qué implica bloquear a alguien</Text>
      </View>
      <View className="gap-3.5 px-4 py-3.5">
        {IMPLICATIONS.map(({ Icon, title, description }) => (
          <View key={title} className="flex-row gap-3">
            <View className="h-7 w-7 items-center justify-center rounded-full bg-bg-mute">
              <Icon size={14} strokeWidth={1.8} color={colors.fg2} />
            </View>
            <View className="flex-1">
              <Text className="font-sans-medium text-[13px] text-fg">{title}</Text>
              <Text className="mt-0.5 font-sans text-[12px] leading-[17px] text-fg-3">{description}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
