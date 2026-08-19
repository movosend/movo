import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router } from "expo-router";
import { ChevronLeft, PackageX, Search, SlidersHorizontal, WifiOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ShipmentCard } from "../../../components/shipments/shipment-card";
import { SkeletonBlock as Block } from "../../../components/ui/skeleton-block";
import { usePublicProfiles } from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useMyShipments } from "../../../src/hooks/use-shipments";
import { capitalizeName } from "../../../src/lib/profile-format";
import { shipmentLifecycleStage, shipmentStatusLabel } from "../../../src/lib/shipment-format";

type LifecycleStage = "ongoing" | "past";
type StatusFilter = ShipmentStatus | "all";
type ReceiverFilter = string | "all";

const STAGE_LABEL: Record<LifecycleStage, string> = {
  ongoing: "En curso",
  past: "Completados",
};

const STAGE_STATUSES: Record<LifecycleStage, ShipmentStatus[]> = {
  ongoing: [
    ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
    ShipmentStatus.PUBLISHED,
    ShipmentStatus.ASSIGNMENT_PENDING,
    ShipmentStatus.ASSIGNED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.DISPUTED,
  ],
  past: [ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED, ShipmentStatus.REJECTED_BY_RECEIVER],
};

const STAGE_EMPTY_TEXT: Record<LifecycleStage, string> = {
  ongoing: "No tenés envíos en curso.",
  past: "Todavía no tenés envíos completados.",
};

const ALL_OPTION_ID = "all";

/** Cuántos destinatarios se ofrecen como pill sin buscar — más allá de eso, la fila deja
 * de leerse como un filtro y hay que escribir para llegar al resto. */
const TOP_RECEIVERS_SHOWN = 3;

interface FilterOption {
  id: string;
  label: string;
}

function ShipmentsListSkeleton() {
  return (
    <View className="gap-3 px-5 pt-4">
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} className="h-[104px] rounded-[16px]" />
      ))}
    </View>
  );
}

/**
 * Pills de filtro (MOVO-127, tercera vuelta de feedback post-QA con la referencia de
 * Uber "Activity" → "Filter by…" a la vista): fila de pills con scroll horizontal, en
 * vez de un dropdown que abría un `Modal` arriba de la hoja ("es medio raro que una
 * card se abra arriba de otra card") o de un acordeón que empujaba el contenido. Todas
 * las opciones quedan visibles de una, la hoja no cambia de alto al elegir, y no hace
 * falta scroll vertical.
 */
function FilterPillRow({
  options,
  valueId,
  onChange,
  testID,
}: {
  options: FilterOption[];
  valueId: string;
  onChange: (id: string) => void;
  testID?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
    >
      {options.map((option) => {
        const selected = option.id === valueId;
        return (
          <Pressable
            key={option.id}
            testID={testID ? `${testID}-option-${option.id}` : undefined}
            onPress={() => onChange(option.id)}
            className={`rounded-full px-4 py-2.5 ${selected ? "bg-fg" : "bg-bg-mute"}`}
          >
            <Text
              numberOfLines={1}
              className={`font-sans-medium text-small ${selected ? "text-bg" : "text-fg"}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Hoja de filtro (MOVO-127, referencia visual Uber "Activity" — "Filter by…"): título
 * centrado, un grupo de pills por criterio y "Aplicar" de ancho completo al pie.
 * "Estado" depende de la tab activa (no tiene sentido ofrecer "Entregado" en "En
 * curso"); "Destinatario" resuelve nombres reales vía `usePublicProfiles` (MOVO-77),
 * muestra como pill solo a los `TOP_RECEIVERS_SHOWN` más frecuentes y deja al resto
 * detrás del buscador, que filtra sobre la lista completa.
 *
 * Estado "draft" propio: cada pill actualiza el borrador, "Aplicar" confirma ambos
 * filtros de una y cierra; "Limpiar" resetea borrador y filtro aplicado sin cerrar. Se
 * re-sincroniza desde los filtros aplicados cada vez que la hoja se abre.
 *
 * `useSafeAreaInsets` (no `SafeAreaView`) para el padding inferior: el botón "Aplicar"
 * tiene que quedar por encima del home indicator, pero el fondo de la hoja tiene que
 * pintar *debajo* de él — un `SafeAreaView` recorta el fondo y deja la zona
 * transparente, que es exactamente lo que se veía mal. Las pills escapan del padding
 * lateral a propósito (`paddingHorizontal` va en el `contentContainerStyle` del
 * `ScrollView`, no en el contenedor) para que la fila sangre hasta el borde y se lea
 * como scrolleable.
 */
function ShipmentsFilterSheet({
  visible,
  onClose,
  stage,
  appliedStatus,
  appliedReceiver,
  receiverOptions,
  onApply,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  stage: LifecycleStage;
  appliedStatus: StatusFilter;
  appliedReceiver: ReceiverFilter;
  receiverOptions: FilterOption[];
  onApply: (status: StatusFilter, receiver: ReceiverFilter) => void;
  onClear: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const [draftStatus, setDraftStatus] = useState<StatusFilter>(appliedStatus);
  const [draftReceiver, setDraftReceiver] = useState<ReceiverFilter>(appliedReceiver);
  const [receiverQuery, setReceiverQuery] = useState("");

  useEffect(() => {
    if (visible) {
      setDraftStatus(appliedStatus);
      setDraftReceiver(appliedReceiver);
      setReceiverQuery("");
    }
  }, [visible, appliedStatus, appliedReceiver]);

  const statusOptions: FilterOption[] = [
    { id: ALL_OPTION_ID, label: "Todos" },
    ...STAGE_STATUSES[stage].map((status) => ({ id: status, label: shipmentStatusLabel(status) })),
  ];
  const normalizedQuery = receiverQuery.trim().toLowerCase();
  // Sin búsqueda, solo los `TOP_RECEIVERS_SHOWN` destinatarios más frecuentes (vienen ya
  // ordenados por frecuencia): una fila de pills con decenas de nombres es una lista
  // disfrazada de filtro. El resto se llega escribiendo — por eso el buscador filtra
  // sobre `receiverOptions` completo, no sobre el recorte visible. El destinatario ya
  // elegido se fuerza dentro del recorte para que su pill no desaparezca al reabrir la
  // hoja si no está entre los más frecuentes.
  const visibleReceiverOptions = normalizedQuery
    ? receiverOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : receiverOptions.filter(
        (option, index) => index < TOP_RECEIVERS_SHOWN || option.id === draftReceiver,
      );
  const receiverOptionsWithAll: FilterOption[] = [
    { id: ALL_OPTION_ID, label: "Todos" },
    ...visibleReceiverOptions,
  ];
  const isDraftActive = draftStatus !== "all" || draftReceiver !== "all";

  const handleClear = () => {
    setDraftStatus("all");
    setDraftReceiver("all");
    setReceiverQuery("");
    onClear();
  };

  const handleApply = () => {
    onApply(draftStatus, draftReceiver);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable testID="shipments-filter-backdrop" className="absolute inset-0 bg-black/40" onPress={onClose} />

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View className="rounded-t-3xl bg-bg" style={{ paddingBottom: insets.bottom + 16 }}>
            <View className="items-center border-b border-border px-5 pb-3.5 pt-4">
              <Text className="font-sans-semibold text-[17px] text-fg">Filtrar por…</Text>
              {isDraftActive ? (
                <Text
                  testID="shipments-filter-clear"
                  onPress={handleClear}
                  className="absolute right-5 top-[18px] font-sans-medium text-small text-fg-2"
                >
                  Limpiar
                </Text>
              ) : null}
            </View>

            <View className="gap-2.5 pt-5">
              <Text className="px-5 font-sans-semibold text-[17px] text-fg">Estado</Text>
              <FilterPillRow
                testID="shipments-filter-status"
                options={statusOptions}
                valueId={draftStatus}
                onChange={(id) => setDraftStatus(id === ALL_OPTION_ID ? "all" : (id as ShipmentStatus))}
              />
            </View>

            <View className="gap-2.5 pt-6">
              <Text className="px-5 font-sans-semibold text-[17px] text-fg">Destinatario</Text>
              <View className="px-5">
                <View className="flex-row items-center gap-2 rounded-full bg-bg-mute px-3.5 py-2.5">
                  <Search size={16} color={colors.fg3} strokeWidth={2} />
                  <TextInput
                    testID="shipments-filter-receiver-search"
                    value={receiverQuery}
                    onChangeText={setReceiverQuery}
                    placeholder="Buscar destinatario"
                    placeholderTextColor={colors.fg3}
                    autoCorrect={false}
                    className="flex-1 p-0 font-sans text-small text-fg"
                  />
                </View>
              </View>
              {normalizedQuery && visibleReceiverOptions.length === 0 ? (
                <Text className="px-5 font-sans text-small text-fg-3">Sin resultados.</Text>
              ) : (
                <FilterPillRow
                  testID="shipments-filter-receiver"
                  options={receiverOptionsWithAll}
                  valueId={draftReceiver}
                  onChange={(id) => setDraftReceiver(id === ALL_OPTION_ID ? "all" : id)}
                />
              )}
            </View>

            <View className="px-5 pt-7">
              <Pressable
                testID="shipments-filter-apply"
                onPress={handleApply}
                className="w-full items-center rounded-full bg-fg py-4"
              >
                <Text className="font-sans-semibold text-body text-bg">Aplicar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}


/**
 * "Mis Envíos" (MOVO-127): listado completo y paginado de `GET /shipments/mine`, a
 * diferencia del preview de 3 que muestra "Actividad reciente" en Inicio. Título
 * grande + tabs "En curso"/"Completados" + filtro por estado/destinatario (referencia
 * visual Uber "Activity", feedback post-QA) — patrón estándar de listados de
 * pedidos/viajes. `FlatList` de `react-native-gesture-handler` (no el de React Native)
 * por consistencia con el resto del paquete `shipments/` (`photo-viewer-modal.tsx`).
 *
 * Filtros y tab activa son puramente client-side sobre las páginas ya cargadas —
 * `GET /shipments/mine` no soporta parámetros de filtro en el backend todavía
 * (MOVO-80). El scroll infinito sigue pidiendo la próxima página según `hasNextPage`
 * de la query completa, sin depender de cuántos items sobrevivan a los filtros
 * visibles — aceptable para el volumen de envíos de un usuario real.
 */
export default function MyShipmentsScreen() {
  const colors = useThemeColors();
  const { data, isLoading, isError, isRefetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMyShipments();
  const [stage, setStage] = useState<LifecycleStage>("ongoing");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [receiverFilter, setReceiverFilter] = useState<ReceiverFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)/home");
    }
  };

  const handleStageChange = (nextStage: LifecycleStage) => {
    setStage(nextStage);
    setStatusFilter("all");
    setReceiverFilter("all");
  };

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const stageItems = items.filter((item) => shipmentLifecycleStage(item.status) === stage);

  // Ordenados por frecuencia (más envíos primero): la hoja de filtro solo muestra los
  // primeros como pills y deja el resto detrás del buscador, así que cuáles quedan a la
  // vista tiene que ser "los que más usás", no el orden en que llegaron de la API.
  const receiverCounts = new Map<string, number>();
  for (const item of stageItems) {
    receiverCounts.set(item.receiverId, (receiverCounts.get(item.receiverId) ?? 0) + 1);
  }
  const receiverIdsByFrequency = Array.from(receiverCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const receiverProfiles = usePublicProfiles(receiverIdsByFrequency);
  const receiverOptions: FilterOption[] = receiverIdsByFrequency.map((id, index) => ({
    id,
    label: capitalizeName(receiverProfiles[index]?.data?.fullName) || "Destinatario",
  }));

  const visibleItems = stageItems
    .filter((item) => statusFilter === "all" || item.status === statusFilter)
    .filter((item) => receiverFilter === "all" || item.receiverId === receiverFilter);
  const isFilterActive = statusFilter !== "all" || receiverFilter !== "all";

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-2 pt-1.5">
        <Pressable
          testID="my-shipments-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
      </View>

      <Text className="px-5 pb-4 font-sans-semibold text-title text-fg">Mis envíos</Text>

      <View className="flex-row items-center justify-between px-5 pb-3">
        <View className="flex-row gap-2">
          {(Object.keys(STAGE_LABEL) as LifecycleStage[]).map((s) => (
            <Pressable
              key={s}
              testID={`my-shipments-stage-${s}`}
              onPress={() => handleStageChange(s)}
              className={`rounded-full px-4 py-2 ${stage === s ? "bg-fg" : "bg-bg-mute"}`}
            >
              <Text className={`font-sans-medium text-small ${stage === s ? "text-bg" : "text-fg-2"}`}>
                {STAGE_LABEL[s]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          testID="my-shipments-filter-open"
          onPress={() => setFilterOpen(true)}
          className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
        >
          <SlidersHorizontal size={16} strokeWidth={1.8} color={colors.fg1} />
          {isFilterActive ? (
            <View testID="my-shipments-filter-dot" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-lime-500" />
          ) : null}
        </Pressable>
      </View>

      {isLoading ? (
        <ShipmentsListSkeleton />
      ) : isError ? (
        <View className="items-center gap-2 px-5 py-10">
          <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-small text-fg-2">No pudimos cargar tus envíos.</Text>
          <Text onPress={() => refetch()} className="font-sans-medium text-small text-fg">
            Reintentar
          </Text>
        </View>
      ) : stageItems.length === 0 ? (
        <View className="items-center gap-2 px-5 py-10">
          <PackageX size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-small text-fg-2">{STAGE_EMPTY_TEXT[stage]}</Text>
        </View>
      ) : visibleItems.length === 0 ? (
        <View className="items-center gap-2 px-5 py-10">
          <PackageX size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-small text-fg-2">No hay envíos con ese filtro.</Text>
          <Text
            testID="my-shipments-clear-filter"
            onPress={() => {
              setStatusFilter("all");
              setReceiverFilter("all");
            }}
            className="font-sans-medium text-small text-fg"
          >
            Quitar filtro
          </Text>
        </View>
      ) : (
        <FlatList
          testID="my-shipments-list"
          data={visibleItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
          renderItem={({ item }) => <ShipmentCard shipment={item} testID={`my-shipments-card-${item.id}`} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              void fetchNextPage();
            }
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
      )}

      <ShipmentsFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        stage={stage}
        appliedStatus={statusFilter}
        appliedReceiver={receiverFilter}
        receiverOptions={receiverOptions}
        onApply={(status, receiver) => {
          setStatusFilter(status);
          setReceiverFilter(receiver);
        }}
        onClear={() => {
          setStatusFilter("all");
          setReceiverFilter("all");
        }}
      />
    </SafeAreaView>
  );
}
