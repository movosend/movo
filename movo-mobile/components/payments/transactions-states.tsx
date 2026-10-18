import type { TransactionRole } from "@movo/shared/dist/types/transaction";
import { AlertCircle, ArrowDownLeft, ArrowUpRight, CreditCard, Search } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { noResultsTitle, TRANSACTION_EMPTY_COPY } from "../../src/lib/transaction-format";
import { SkeletonBlock } from "../ui/skeleton-block";

/** Estados de pantalla del historial (MOVO-304 AC13), fieles al canvas de Claude Design. */

const SKELETON_WIDTHS = [
  ["58%", "38%"],
  ["52%", "34%"],
  ["64%", "42%"],
  ["56%", "36%"],
  ["60%", "40%"],
  ["50%", "32%"],
] as const;

export function TransactionsSkeleton() {
  return (
    <View testID="transactions-loading" accessibilityLabel="Cargando el historial">
      <SkeletonBlock className="mx-5 mb-1.5 mt-5 h-[11px] w-20 rounded-md" />
      {SKELETON_WIDTHS.map(([titleWidth, subtitleWidth], index) => (
        <View key={index} className="flex-row items-center gap-3 border-b border-border px-5 py-3.5">
          <SkeletonBlock className="h-10 w-10 rounded-full" />
          <View className="flex-1 gap-[7px]">
            <SkeletonBlock className="h-[11px] rounded-md" style={{ width: titleWidth }} />
            <SkeletonBlock className="h-[11px] rounded-md" style={{ width: subtitleWidth }} />
          </View>
          <SkeletonBlock className="h-[26px] w-[70px] rounded-full" />
        </View>
      ))}
    </View>
  );
}

function StateIcon({ children, badge }: { children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <View className="mb-1.5 h-16 w-16 items-center justify-center rounded-full bg-bg-mute">
      {children}
      {badge}
    </View>
  );
}

function PrimaryAction({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="mt-2.5 h-12 items-center justify-center rounded-[14px] bg-lime-500 px-[22px] active:opacity-80"
    >
      <Text className="font-sans-semibold text-[15px] text-ink-950">{label}</Text>
    </Pressable>
  );
}

/** Vacío por tab, con la acción que lleva a generar el primer movimiento. */
export function TransactionsEmpty({ role, onAction }: { role: TransactionRole; onAction: () => void }) {
  const colors = useThemeColors();
  const copy = TRANSACTION_EMPTY_COPY[role];
  const Direction = role === "sender" ? ArrowUpRight : ArrowDownLeft;
  return (
    <View testID={`transactions-empty-${role}`} className="flex-1 items-center justify-center gap-2 px-10 pb-20">
      <StateIcon
        badge={
          <View
            className={`absolute -bottom-1 -right-1 h-[26px] w-[26px] items-center justify-center rounded-full border-[3px] border-bg ${
              role === "sender" ? "bg-fg" : "bg-bg-mute"
            }`}
          >
            <Direction size={13} color={role === "sender" ? colors.bg : colors.fg1} strokeWidth={3} />
          </View>
        }
      >
        <CreditCard size={28} color={colors.fg1} strokeWidth={2} />
      </StateIcon>
      <Text className="text-center font-sans-semibold text-h2 text-fg">{copy.title}</Text>
      <Text className="text-center font-sans text-[14px] leading-[20px] text-fg-2">{copy.description}</Text>
      <PrimaryAction testID={`transactions-empty-action-${role}`} label={copy.cta} onPress={onAction} />
    </View>
  );
}

/** Hay filtros activos y ninguna transacción los cumple. */
export function TransactionsNoResults({ role, onClear }: { role: TransactionRole; onClear: () => void }) {
  const colors = useThemeColors();
  return (
    <View testID="transactions-no-results" className="flex-1 items-center justify-center gap-2 px-10 pb-20">
      <StateIcon>
        <Search size={28} color={colors.fg1} strokeWidth={2} />
      </StateIcon>
      <Text className="text-center font-sans-semibold text-h2 text-fg">{noResultsTitle(role)}</Text>
      <Text className="text-center font-sans text-[14px] leading-[20px] text-fg-2">
        Probá con otro estado o con un rango de fechas más amplio.
      </Text>
      <Pressable
        testID="transactions-clear-filters"
        accessibilityRole="button"
        onPress={onClear}
        className="mt-2.5 h-12 items-center justify-center rounded-[14px] border-[1.5px] border-fg px-[22px] active:opacity-80"
      >
        <Text className="font-sans-semibold text-[15px] text-fg">Limpiar filtros</Text>
      </Pressable>
    </View>
  );
}

/** Falla la carga de la lista o del detalle: mensaje y "Reintentar". */
export function TransactionsError({
  message,
  onRetry,
  testID = "transactions-error",
}: {
  message: string;
  onRetry?: () => void;
  testID?: string;
}) {
  return (
    <View testID={testID} className="items-center gap-4 px-5 pt-4">
      <View className="w-full flex-row gap-2.5 rounded-[14px] border border-danger-300 bg-danger-100 p-3.5">
        <AlertCircle size={20} color="#A8262C" strokeWidth={2} style={{ marginTop: 1 }} />
        <Text className="flex-1 font-sans text-[14px] leading-[19px] text-ink-950">{message}</Text>
      </View>
      {onRetry ? (
        <Pressable
          testID={`${testID}-retry`}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
          onPress={onRetry}
          className="h-12 items-center justify-center rounded-[14px] border-[1.5px] border-fg px-7 active:opacity-80"
        >
          <Text className="font-sans-semibold text-[15px] text-fg">Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
