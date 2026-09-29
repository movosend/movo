import { router } from "expo-router";
import { ChevronLeft, PackageX, WifiOff } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { MyShipmentHistoryRow, MyShipmentRow } from "../../../components/shipments/my-shipment-row";
import {
  MyShipmentsActiveFilters,
  MyShipmentsFilterButton,
  MyShipmentsRoleCard,
  MyShipmentsStageSelector,
} from "../../../components/shipments/my-shipments-controls";
import { MyShipmentsFilterSheet } from "../../../components/shipments/my-shipments-filter-sheet";
import { SkeletonBlock as Block } from "../../../components/ui/skeleton-block";
import type { ShipmentSummary } from "../../../src/api/shipments-client";
import { usePublicProfiles } from "../../../src/hooks/use-profile";
import { useMyShipments } from "../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import {
  activeCountLabel,
  compareOngoing,
  groupHistoryByMonth,
  myShipmentCounterpartId,
  myShipmentRole,
  ongoingListTitle,
  personIdsByFrequency,
  presentMyShipment,
  statusFilterOptions,
  type MyShipmentPresentation,
  type MyShipmentRole,
  type MyShipmentStripTarget,
  type MyShipmentsStage,
} from "../../../src/lib/my-shipments-format";
import { capitalizeName } from "../../../src/lib/profile-format";
import { useAuthStore } from "../../../src/store/auth-store";

type RoleFilter = MyShipmentRole | "all";

interface Entry {
  shipment: ShipmentSummary;
  presentation: MyShipmentPresentation;
}

type ListItem = { kind: "row"; entry: Entry } | { kind: "month"; month: string };

const EMPTY_TEXT: Record<MyShipmentsStage, string> = {
  ongoing: "No tenés envíos en curso.",
  history: "Todavía no tenés envíos en tu historial.",
};

function Eyebrow({ children, className = "" }: { children: string; className?: string }) {
  return (
    <Text
      className={`px-5 pb-1 font-sans-semibold text-[12px] uppercase tracking-[0.96px] text-fg-2 ${className}`}
    >
      {children}
    </Text>
  );
}

function ListSkeleton() {
  return (
    <View className="gap-3 px-5 pt-5">
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} className="h-[72px] rounded-[10px]" />
      ))}
    </View>
  );
}

function stripRoute(target: MyShipmentStripTarget, shipmentId: string) {
  if (target === "offers") return `/shipments/${shipmentId}/offers` as const;
  if (target === "change_receiver") return `/shipments/${shipmentId}/change-receiver` as const;
  return `/shipments/${shipmentId}` as const;
}

/**
 * "Mis envíos" (MOVO-257, prototipo de Claude Design "Mis envíos 4a"): envíos donde el
 * usuario es emisor o receptor, con accesos por rol, "En curso"/"Historial", franjas de
 * acción cuando algo espera al usuario y filtros de Estado y Persona.
 *
 * Todo el filtrado y el orden es client-side sobre las páginas ya cargadas de
 * `GET /shipments/mine` (mismo criterio aceptado desde MOVO-127): el scroll infinito
 * pide la próxima página según `hasNextPage`, sin mirar cuántos ítems sobreviven al filtro.
 */
export default function MyShipmentsScreen() {
  const colors = useThemeColors();
  const currentUserId = useAuthStore((s) => s.user?.userId) ?? "";
  const { data, isLoading, isError, isRefetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMyShipments();
  const [stage, setStage] = useState<MyShipmentsStage>("ongoing");
  const [role, setRole] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const shipments = data?.pages.flatMap((page) => page.items) ?? [];

  // Nombres de la otra parte de cada envío: para las franjas ("Martín te manda un
  // paquete") y las opciones del filtro de Persona. `usePublicProfiles` comparte cache
  // con el resto de la app, un perfil ya cargado no se vuelve a pedir.
  const counterpartIds = [
    ...new Set(shipments.map((s) => myShipmentCounterpartId(s, myShipmentRole(s, currentUserId)))),
  ];
  const profiles = usePublicProfiles(counterpartIds);
  const nameById = new Map(
    counterpartIds.map((id, index) => [id, capitalizeName(profiles[index]?.data?.fullName) || null]),
  );

  const now = new Date();
  const entries: Entry[] = shipments.map((shipment) => {
    const counterpartId = myShipmentCounterpartId(shipment, myShipmentRole(shipment, currentUserId));
    return {
      shipment,
      presentation: presentMyShipment(shipment, currentUserId, { counterpartName: nameById.get(counterpartId), now }),
    };
  });

  const ongoing = entries.filter((e) => e.presentation.stage === "ongoing");
  const roleSummary = (r: MyShipmentRole) => {
    const ofRole = ongoing.filter((e) => e.presentation.role === r);
    return { countLabel: activeCountLabel(ofRole.length), needsAction: ofRole.some((e) => e.presentation.strip) };
  };

  const stageEntries = entries.filter((e) => e.presentation.stage === stage);
  const roleEntries = role === "all" ? stageEntries : stageEntries.filter((e) => e.presentation.role === role);
  const statusOptions = statusFilterOptions(roleEntries);
  const visibleEntries = roleEntries
    .filter((e) => personFilter === null || e.presentation.counterpartId === personFilter)
    .filter((e) => statusFilter === null || e.presentation.statusKey === statusFilter);

  const personOptions = personIdsByFrequency(entries, role).map((id) => ({
    id,
    label: nameById.get(id) ?? "Usuario de Movo",
  }));

  const listItems: ListItem[] =
    stage === "ongoing"
      ? [...visibleEntries].sort(compareOngoing).map((entry) => ({ kind: "row", entry }))
      : groupHistoryByMonth(visibleEntries, now).flatMap((group) => [
          { kind: "month" as const, month: group.month },
          ...group.items.map((entry) => ({ kind: "row" as const, entry })),
        ]);

  const isFilterActive = statusFilter !== null || personFilter !== null;
  const clearFilters = () => {
    setStatusFilter(null);
    setPersonFilter(null);
  };

  const handleRolePress = (r: MyShipmentRole) => {
    const next: RoleFilter = role === r ? "all" : r;
    setRole(next);
    // El filtro de Persona sobrevive al cambio de rol solo si esa persona sigue
    // apareciendo en el rol nuevo; el de Estado, si ese estado sigue existiendo.
    if (
      personFilter !== null &&
      next !== "all" &&
      !entries.some((e) => e.presentation.role === next && e.presentation.counterpartId === personFilter)
    ) {
      setPersonFilter(null);
    }
    if (
      statusFilter !== null &&
      !stageEntries.some(
        (e) => (next === "all" || e.presentation.role === next) && e.presentation.statusKey === statusFilter,
      )
    ) {
      setStatusFilter(null);
    }
  };

  const handleStageChange = (next: MyShipmentsStage) => {
    setStage(next);
    // Las opciones de Estado son distintas por pestaña; la persona se conserva para ver
    // "todo lo que tuve con Martín" en las dos.
    setStatusFilter(null);
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/home");
  };

  const activeChips = [
    ...(personFilter !== null
      ? [{ id: "person", label: nameById.get(personFilter) ?? "Usuario de Movo", onRemove: () => setPersonFilter(null) }]
      : []),
    ...(statusFilter !== null
      ? [
          {
            id: "status",
            label: statusOptions.find((o) => o.id === statusFilter)?.label ?? statusFilter,
            onRemove: () => setStatusFilter(null),
          },
        ]
      : []),
  ];

  const header = (
    <View>
      <View className="gap-4 px-5 pt-2">
        <View className="flex-row items-center gap-3">
          <Pressable
            testID="my-shipments-back"
            accessibilityLabel="Volver"
            onPress={handleBack}
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
          </Pressable>
          <Text className="flex-1 font-sans-semibold text-h3 text-fg">Mis envíos</Text>
        </View>

        <View className="flex-row gap-2.5">
          {(["sending", "receiving"] as const).map((r) => {
            const summary = roleSummary(r);
            return (
              <MyShipmentsRoleCard
                key={r}
                role={r}
                selected={role === r}
                countLabel={summary.countLabel}
                needsAction={summary.needsAction}
                onPress={() => handleRolePress(r)}
              />
            );
          })}
        </View>

        <View className="flex-row items-center gap-2.5">
          <MyShipmentsStageSelector stage={stage} onChange={handleStageChange} />
          <MyShipmentsFilterButton active={isFilterActive} onPress={() => setFilterOpen(true)} />
        </View>
      </View>

      <View className="mx-5 mt-[18px] h-px bg-border" />

      {stage === "ongoing" && !isLoading && !isError ? (
        <Eyebrow className="pt-4">{ongoingListTitle(visibleEntries.length, role)}</Eyebrow>
      ) : null}
      <MyShipmentsActiveFilters chips={activeChips} />
    </View>
  );

  const empty = isLoading ? (
    <ListSkeleton />
  ) : isError ? (
    <View className="items-center gap-2 px-5 py-10">
      <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
      <Text className="text-center font-sans text-small text-fg-2">No pudimos cargar tus envíos.</Text>
      <Text onPress={() => refetch()} className="font-sans-medium text-small text-fg">
        Reintentar
      </Text>
    </View>
  ) : (
    <View className="items-center gap-2 px-5 py-10">
      <PackageX size={22} strokeWidth={1.8} color={colors.fg3} />
      {roleEntries.length === 0 ? (
        <Text className="text-center font-sans text-small text-fg-2">{EMPTY_TEXT[stage]}</Text>
      ) : (
        <>
          <Text className="text-center font-sans text-small text-fg-2">No hay envíos con ese filtro.</Text>
          <Text testID="my-shipments-clear-filter" onPress={clearFilters} className="font-sans-medium text-small text-fg">
            Quitar filtros
          </Text>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <FlatList
        testID="my-shipments-list"
        data={isLoading || isError ? [] : listItems}
        keyExtractor={(item) => (item.kind === "row" ? item.entry.shipment.id : `month-${item.month}`)}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: 48 }}
        renderItem={({ item }) => {
          if (item.kind === "month") return <Eyebrow className="pt-[22px]">{item.month}</Eyebrow>;
          const { shipment, presentation } = item.entry;
          const testID = `my-shipments-row-${shipment.id}`;
          const openDetail = () => router.push(`/shipments/${shipment.id}`);
          return stage === "ongoing" ? (
            <MyShipmentRow
              testID={testID}
              presentation={presentation}
              showRoleTag={role === "all"}
              onPress={openDetail}
              onStripPress={() => router.push(stripRoute(presentation.strip?.target ?? "detail", shipment.id))}
            />
          ) : (
            <MyShipmentHistoryRow testID={testID} presentation={presentation} onPress={openDetail} />
          );
        }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        refreshControl={
          <RefreshControl testID="my-shipments-refresh" refreshing={isRefetching} onRefresh={() => refetch()} />
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View className="items-center py-4">
              <ActivityIndicator color={colors.fg3} />
            </View>
          ) : null
        }
      />

      <MyShipmentsFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        appliedStatus={statusFilter}
        appliedPerson={personFilter}
        statusOptions={statusOptions}
        personOptions={personOptions}
        onApply={(status, person) => {
          setStatusFilter(status);
          setPersonFilter(person);
        }}
      />
    </SafeAreaView>
  );
}
