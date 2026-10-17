import type { TransactionListItem, TransactionRole, TransactionStatus } from "@movo/shared/dist/types/transaction";
import { router, useFocusEffect } from "expo-router";
import { Calendar, ChevronLeft, Filter, X } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TransactionFiltersSheet } from "../../../../../components/payments/transaction-filters-sheet";
import { TransactionRow } from "../../../../../components/payments/transaction-row";
import {
  TransactionsEmpty,
  TransactionsError,
  TransactionsNoResults,
  TransactionsSkeleton,
} from "../../../../../components/payments/transactions-states";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";
import {
  EMPTY_TRANSACTION_FILTERS,
  transactionFilterCount,
  useTransactions,
  type TransactionFilters,
} from "../../../../../src/hooks/use-transactions";
import { friendlyErrorMessage } from "../../../../../src/lib/error-messages";
import {
  dateRangeLabel,
  groupTransactionsByMonth,
  resultsCountLabel,
  transactionStatusLabel,
} from "../../../../../src/lib/transaction-format";

type ListRow =
  | { type: "month"; key: string; label: string }
  | { type: "item"; key: string; item: TransactionListItem };

const TABS: { role: TransactionRole; label: string }[] = [
  { role: "sender", label: "Pagos" },
  { role: "carrier", label: "Cobros" },
];

function ActiveChip({ label, onRemove, testID }: { label: string; onRemove: () => void; testID: string }) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Quitar filtro ${label}`}
      onPress={onRemove}
      className="h-9 flex-row items-center gap-1.5 rounded-full bg-fg px-3 active:opacity-80"
    >
      <Text className="font-sans-medium text-[13px] text-bg">{label}</Text>
      <X size={14} color={colors.bg} strokeWidth={2.4} />
    </Pressable>
  );
}

function FilterButton({
  label,
  icon: Icon,
  onPress,
  testID,
}: {
  label: string;
  icon: typeof Filter;
  onPress: () => void;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Filtrar por ${label.toLowerCase()}`}
      onPress={onPress}
      className="h-9 flex-row items-center gap-1.5 rounded-full border border-border-strong bg-bg px-3 active:bg-bg-sub"
    >
      <Icon size={16} color={colors.fg1} strokeWidth={2} />
      <Text className="font-sans-medium text-[13px] text-fg">{label}</Text>
    </Pressable>
  );
}

/**
 * Historial de pagos y cobros (MOVO-304, sub-issue mobile de MOVO-28), desde Pagos y cobros.
 *
 * Fiel al canvas de Claude Design "MOVO-28 Historial de pagos y cobros": dos tabs, **Pagos**
 * (`role=sender`) y **Cobros** (`role=carrier`), cada una con sus propios filtros y su propia
 * paginación por cursor (la query key lleva el rol y los filtros, así volver a una tab no
 * pierde lo ya cargado). La lista se agrupa por mes y se refresca al volver a la pantalla.
 *
 * Desvíos del canvas, por lo que el backend de MOVO-303 no informa: el resumen "Cobrado en
 * octubre / Por acreditar" de la tab Cobros no está (no hay agregados), las filas de Cobros
 * muestran lo que pagó el emisor (el neto está solo en el detalle) y el contador de la barra
 * de filtros cuenta lo ya cargado ("20+ pagos" si hay más páginas) porque no hay total.
 */
export default function PaymentsHistoryScreen() {
  const colors = useThemeColors();
  const [role, setRole] = useState<TransactionRole>("sender");
  const [filtersByRole, setFiltersByRole] = useState<Record<TransactionRole, TransactionFilters>>({
    sender: EMPTY_TRANSACTION_FILTERS,
    carrier: EMPTY_TRANSACTION_FILTERS,
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const filters = filtersByRole[role];
  const filterCount = transactionFilterCount(filters);
  const query = useTransactions(role, filters);
  const { refetch } = query;

  // Al volver a la pantalla (por ejemplo, del detalle de un envío) un pago pudo cambiar de
  // estado. El primer foco no refetchea: la query ya se pidió al montar.
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const rows = useMemo<ListRow[]>(
    () =>
      groupTransactionsByMonth(items).flatMap((section) => [
        { type: "month" as const, key: `month-${section.key}`, label: section.label },
        ...section.items.map((item) => ({ type: "item" as const, key: item.id, item })),
      ]),
    [items],
  );

  const setFilters = (next: TransactionFilters) => setFiltersByRole((prev) => ({ ...prev, [role]: next }));
  const clearFilters = () => setFilters(EMPTY_TRANSACTION_FILTERS);
  const removeStatus = (status: TransactionStatus) =>
    setFilters({ ...filters, statuses: filters.statuses.filter((s) => s !== status) });

  const openDetail = (id: string) =>
    router.push({ pathname: "/profile/payments/history/[id]", params: { id, role } });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const rangeLabel = dateRangeLabel(filters.from, filters.to);
  const hasData = !!query.data;

  let body: React.ReactNode;
  if (query.isPending) {
    body = <TransactionsSkeleton />;
  } else if (query.isError && !hasData) {
    body = (
      <TransactionsError
        message={friendlyErrorMessage(query.error, "No pudimos cargar tu historial. Revisá tu conexión e intentá de nuevo.")}
        onRetry={() => void refetch()}
      />
    );
  } else if (items.length === 0) {
    body =
      filterCount > 0 ? (
        <TransactionsNoResults role={role} onClear={clearFilters} />
      ) : (
        <TransactionsEmpty
          role={role}
          onAction={() => router.push(role === "sender" ? "/send" : "/(app)/(tabs)/transport")}
        />
      );
  } else {
    body = (
      <FlatList
        testID="transactions-list"
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) =>
          row.type === "month" ? (
            <Text
              accessibilityRole="header"
              className="px-5 pb-1.5 pt-4 font-sans-semibold text-caption uppercase text-fg-3"
            >
              {row.label}
            </Text>
          ) : (
            <TransactionRow item={row.item} role={role} onPress={() => openDetail(row.item.id)} />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
        ListFooterComponent={
          query.hasNextPage ? (
            <Pressable
              testID="transactions-load-more"
              accessibilityRole="button"
              disabled={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
              className="mx-5 my-4 h-11 flex-row items-center justify-center gap-2 rounded-xl border border-border-strong bg-bg active:bg-bg-sub"
            >
              {query.isFetchingNextPage ? <ActivityIndicator size="small" color={colors.fg1} /> : null}
              <Text className="font-sans-semibold text-[14px] text-fg">
                {query.isFetchNextPageError ? "Reintentar" : query.isFetchingNextPage ? "Cargando…" : "Cargar más"}
              </Text>
            </Pressable>
          ) : (
            <View className="h-6" />
          )
        }
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-2 pt-1.5">
        <Pressable
          testID="history-back"
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-[17px] leading-[22px] text-fg">Historial</Text>
      </View>

      <View accessibilityRole="tablist" className="mx-5 mt-2 flex-row gap-1 rounded-[14px] bg-bg-mute p-1">
        {TABS.map((tab) => {
          const selected = tab.role === role;
          return (
            <Pressable
              key={tab.role}
              testID={`history-tab-${tab.role}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setRole(tab.role)}
              className={`h-10 flex-1 items-center justify-center rounded-[10px] ${selected ? "bg-fg" : ""}`}
            >
              <Text className={`font-sans-semibold text-[14px] ${selected ? "text-bg" : "text-fg-2"}`}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View testID="history-filter-bar" className="flex-row flex-wrap items-center gap-2 px-5 pb-1.5 pt-3.5">
        {filterCount === 0 ? (
          <>
            <FilterButton testID="history-filter-status" label="Estado" icon={Filter} onPress={() => setSheetOpen(true)} />
            <FilterButton testID="history-filter-dates" label="Fechas" icon={Calendar} onPress={() => setSheetOpen(true)} />
          </>
        ) : (
          <>
            {/* Con filtros activos las etiquetas solo se quitan: este botón vuelve a abrir la hoja. */}
            <FilterButton testID="history-filter-open" label="Filtros" icon={Filter} onPress={() => setSheetOpen(true)} />
            {filters.statuses.map((status) => (
              <ActiveChip
                key={status}
                testID={`history-chip-status-${status}`}
                label={transactionStatusLabel(status, role)}
                onRemove={() => removeStatus(status)}
              />
            ))}
            {rangeLabel ? (
              <ActiveChip
                testID="history-chip-dates"
                label={rangeLabel}
                onRemove={() => setFilters({ ...filters, from: null, to: null })}
              />
            ) : null}
            <Pressable
              testID="history-clear"
              accessibilityRole="button"
              onPress={clearFilters}
              hitSlop={8}
              className="px-1 py-2"
            >
              <Text className="font-sans-semibold text-[13px] text-fg-2">Limpiar</Text>
            </Pressable>
          </>
        )}
        <View className="flex-1" />
        {hasData && items.length > 0 ? (
          <Text testID="history-count" className="font-sans text-[12.5px] text-fg-2">
            {resultsCountLabel(items.length, role, !!query.hasNextPage)}
          </Text>
        ) : null}
      </View>

      <View className="flex-1">{body}</View>

      <TransactionFiltersSheet
        visible={sheetOpen}
        role={role}
        applied={filters}
        onApply={setFilters}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}
