import type { SupportShipmentOption } from "@movo/shared/dist/types/support";
import { Check, ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { supportShipmentRoleLabel, supportShipmentSummary } from "../../src/lib/support-format";
import { ShipmentStatusBadge } from "../shipments/status-badge";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";

export const NO_SHIPMENT_LABEL = "No es sobre un envío";

/**
 * MOVO-324: selector del envío vinculado a una consulta nueva. Se ve como `SelectField`, pero la hoja dibuja filas de
 * dos líneas (código + estado, ruta + rol), por eso no lo reusa. "No es sobre un envío" va siempre primera y es el
 * valor por defecto.
 */
export function ShipmentSelectField({
  label,
  selected,
  options,
  isLoading,
  isError,
  onRetry,
  hasMore,
  onLoadMore,
  onChange,
  testID = "support-shipment-select",
}: {
  label: string;
  selected: SupportShipmentOption | null;
  options: readonly SupportShipmentOption[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onChange: (option: SupportShipmentOption | null) => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);

  const pick = (option: SupportShipmentOption | null) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <View className="gap-1.5">
      <Text className="font-sans-medium text-[12px] text-fg-2">{label}</Text>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        className="w-full flex-row items-center justify-between rounded-md border border-border-strong px-3.5 py-3"
      >
        <Text className="flex-1 font-sans text-body text-fg" numberOfLines={1}>
          {selected ? supportShipmentSummary(selected) : NO_SHIPMENT_LABEL}
        </Text>
        <ChevronDown size={18} color={colors.fg3} strokeWidth={2} />
      </Pressable>

      <BottomSheetModal
        visible={open}
        onRequestClose={() => setOpen(false)}
        testID={`${testID}-sheet`}
        backdropTestID={`${testID}-backdrop`}
        sheetClassName="rounded-t-2xl bg-bg"
      >
        <View className="items-center border-b border-border-strong px-5 py-3.5">
          <Text className="font-sans-medium text-[14px] text-fg">{label}</Text>
        </View>
        <Pressable
          testID={`${testID}-none`}
          onPress={() => pick(null)}
          className="flex-row items-center justify-between px-5 py-3.5"
        >
          <Text className="font-sans-semibold text-body text-fg">{NO_SHIPMENT_LABEL}</Text>
          {!selected ? <Check size={18} color={colors.fg1} strokeWidth={2} /> : null}
        </Pressable>
        <Text className="px-5 pb-1.5 pt-2 font-sans-semibold text-caption uppercase text-fg-3">Tus envíos</Text>
        {isLoading ? (
          <View className="items-center py-6">
            <ActivityIndicator color={colors.fg1} />
          </View>
        ) : isError ? (
          <Pressable testID={`${testID}-retry`} onPress={onRetry} className="px-5 py-3.5">
            <Text className="font-sans text-small text-fg-2">No pudimos cargar tus envíos. Tocá para reintentar.</Text>
          </Pressable>
        ) : (
          <FlatList
            style={{ flexGrow: 0, maxHeight: 360 }}
            data={options}
            keyExtractor={(item) => item.id}
            ListFooterComponent={
              hasMore ? (
                <Pressable testID={`${testID}-more`} onPress={onLoadMore} className="px-5 py-3.5">
                  <Text className="font-sans-semibold text-small text-fg">Ver más envíos</Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                testID={`${testID}-option-${item.id}`}
                onPress={() => pick(item)}
                className="flex-row items-center px-5 py-3"
                style={{ gap: 10 }}
              >
                <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <Text className="font-sans-semibold text-body text-fg">{item.code}</Text>
                    <ShipmentStatusBadge status={item.status as ShipmentStatus} compact />
                    <Text className="font-sans text-fg-3" style={{ fontSize: 12 }}>
                      {supportShipmentRoleLabel(item.role)}
                    </Text>
                  </View>
                  <Text className="font-sans text-small text-fg-2" numberOfLines={1}>
                    {item.route}
                  </Text>
                </View>
                {selected?.id === item.id ? <Check size={18} color={colors.fg1} strokeWidth={2} /> : null}
              </Pressable>
            )}
          />
        )}
      </BottomSheetModal>
    </View>
  );
}
