import * as Haptics from "expo-haptics";
import { MapPinned, Navigation, Radio } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { TripWithAcceptedPackages } from "../../src/api/trips-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatTimeOfDay } from "../../src/lib/time-format";
import {
  formatPackagesCount,
  isTripDepartureToday,
  tripPlaceLabel,
} from "../../src/lib/trip-format";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";

export interface TripStartSheetProps {
  visible: boolean;
  trip: TripWithAcceptedPackages | null;
  onConfirm: () => void;
  onClose: () => void;
  /** Ver `BottomSheetModal#onClosed`: el inicio corre recién acá, con la hoja ya cerrada. */
  onClosed?: () => void;
  testID?: string;
}

/**
 * Confirmación de "Iniciar viaje" (reemplaza al `Alert` nativo). Iniciar no se deshace: arranca el tracking y
 * los envíos pasan a seguirse en vivo, así que la hoja muestra qué viaje es (origen → destino, hora, paquetes)
 * y qué cambia al iniciarlo, con el mismo lenguaje visual que la tarjeta de Inicio: bloque oscuro de la ruta y
 * un solo botón lima.
 */
export function TripStartSheet({
  visible,
  trip,
  onConfirm,
  onClose,
  onClosed,
  testID = "trip-start-sheet",
}: TripStartSheetProps) {
  const colors = useThemeColors();

  // Mientras se cierra, `trip` puede ya no estar: la hoja se queda con el último para no vaciarse en la animación.
  if (!trip) return null;

  const origin = tripPlaceLabel(trip.originAddress);
  const destination = tripPlaceLabel(trip.destinationAddress);
  const time = formatTimeOfDay(trip.departureAt);
  const when = isTripDepartureToday(trip.departureAt)
    ? `Hoy${time ? ` · ${time}` : ""}`
    : time;

  const handleConfirm = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm();
  };

  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      onClosed={onClosed}
      testID={testID}
      backdropTestID={`${testID}-backdrop`}
      backdropClassName="bg-black/50"
      sheetClassName="rounded-t-[28px] bg-bg px-5 pt-3"
      contentClassName="gap-5"
    >
      <View className="items-center">
        <View className="h-1 w-10 rounded-full bg-border" />
      </View>

      <View className="flex-row items-center gap-3.5">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-lime-500">
          <Navigation size={22} color="#0A0A0B" strokeWidth={2} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[22px] tracking-tight text-fg">
            ¿Arrancás el viaje?
          </Text>
          <Text className="font-sans text-small text-fg-2">
            Revisá que sea este antes de salir.
          </Text>
        </View>
      </View>

      {/* La ruta, en el mismo bloque oscuro que la tarjeta de Inicio. */}
      <View
        testID={`${testID}-route`}
        className="rounded-[18px] bg-ink-950 p-4 dark:bg-ink-800"
      >
        <View className="flex-row gap-3">
          <View className="items-center pt-[5px]">
            <View className="h-2.5 w-2.5 rounded-full border-2 border-paper/70" />
            <View className="my-1 w-px flex-1 bg-paper/25" />
            <View className="h-2.5 w-2.5 rounded-full bg-lime-500" />
          </View>
          <View className="flex-1 gap-3">
            <View>
              <Text className="font-sans text-[11px] uppercase tracking-wider text-paper/50">
                Salís de
              </Text>
              <Text
                numberOfLines={1}
                className="font-sans-semibold text-[16px] text-paper"
              >
                {origin}
              </Text>
            </View>
            <View>
              <Text className="font-sans text-[11px] uppercase tracking-wider text-paper/50">
                Llegás a
              </Text>
              <Text
                numberOfLines={1}
                className="font-sans-semibold text-[16px] text-paper"
              >
                {destination}
              </Text>
            </View>
          </View>
        </View>
        <View className="mt-4 flex-row items-center gap-2 border-t border-paper/10 pt-3">
          {when ? (
            <View className="rounded-full bg-lime-500 px-2.5 py-1">
              <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-ink-950">
                {when}
              </Text>
            </View>
          ) : null}
          <Text className="font-sans-medium text-[13px] text-paper/70">
            {formatPackagesCount(trip.acceptedPackagesCount)}
          </Text>
        </View>
      </View>

      <View className="gap-3">
        <View className="flex-row items-start gap-3">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute">
            <Radio size={16} color={colors.fg1} strokeWidth={2} />
          </View>
          <Text className="flex-1 pt-1.5 font-sans text-small leading-5 text-fg-2">
            Compartimos tu ubicación en vivo con quienes esperan tus paquetes,
            hasta que termines el viaje.
          </Text>
        </View>
        <View className="flex-row items-start gap-3">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute">
            <MapPinned size={16} color={colors.fg1} strokeWidth={2} />
          </View>
          <Text className="flex-1 pt-1.5 font-sans text-small leading-5 text-fg-2">
            Seguís el viaje en el mapa, con las paradas de retiro y entrega.
          </Text>
        </View>
      </View>

      <View className="gap-1.5 pb-2">
        <Pressable
          testID={`${testID}-confirm`}
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel="Iniciar viaje"
          className="h-[56px] flex-row items-center justify-center gap-2.5 rounded-[14px] bg-lime-500 active:bg-lime-400"
        >
          <Navigation size={20} color="#0A0A0B" strokeWidth={2} />
          <Text className="font-sans-semibold text-[16px] text-ink-950">
            Iniciar viaje
          </Text>
        </Pressable>
        <Pressable
          testID={`${testID}-cancel`}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Todavía no"
          className="h-11 items-center justify-center rounded-[12px]"
        >
          <Text className="font-sans-medium text-small text-fg-2">
            Todavía no
          </Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}
