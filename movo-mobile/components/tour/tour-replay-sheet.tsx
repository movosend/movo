import type { TourId } from "@movo/shared/dist/config/tours";
import { Package, Truck, type LucideIcon } from "lucide-react-native";
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useMyProfile } from "../../src/hooks/use-profile";
import { useTransportGate } from "../../src/hooks/use-transport-gate";
import { capitalizeName } from "../../src/lib/profile-format";
import { useTourStore } from "../../src/store/tour-store";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";

interface TourReplaySheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * MOVO-169 (AC5): "Ayuda y soporte" de Perfil. Relanza un tour a mano: no escribe
 * `UserTour`. "Cómo transportar" aparece solo si ya puede transportar. El tour arranca
 * recién cuando la hoja terminó de cerrarse, para que no conviva con su `Modal`.
 */
export function TourReplaySheet({ visible, onClose }: TourReplaySheetProps) {
  const { data: profile } = useMyProfile();
  const { canBrowse } = useTransportGate();
  const chosen = useRef<TourId | null>(null);

  const choose = (tourId: TourId) => {
    chosen.current = tourId;
    onClose();
  };

  const startChosen = () => {
    const tourId = chosen.current;
    chosen.current = null;
    if (!tourId) return;
    useTourStore.getState().startTour(tourId, {
      manual: true,
      // Sin datos del feed acá: si no hay envíos, el paso de la primera fila se saltea solo.
      context: { firstName: profile?.firstName ? capitalizeName(profile.firstName) : null, canBrowse, hasFeed: true },
    });
  };

  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      onClosed={startChosen}
      testID="tour-replay-sheet"
      backdropTestID="tour-replay-sheet-backdrop"
      backdropClassName="bg-black/60"
      sheetClassName="rounded-t-[28px] border-t border-border bg-bg-sub px-5 pt-3"
      contentClassName="gap-3"
    >
      <View className="items-center">
        <View className="h-[5px] w-10 rounded-full bg-border-strong" />
      </View>
      <View>
        <Text className="mt-1.5 font-sans-semibold text-[19px] text-fg">¿Qué querés repasar?</Text>
        <Text className="mt-1 font-sans text-[13.5px] text-fg-2">Volvé a ver el tutorial cuando quieras.</Text>
      </View>
      <ReplayOption
        testID="tour-replay-first-steps"
        Icon={Package}
        title="Cómo enviar"
        subtitle="Publicar y seguir tus envíos"
        onPress={() => choose("first_steps")}
      />
      {canBrowse ? (
        <ReplayOption
          testID="tour-replay-carrier"
          Icon={Truck}
          title="Cómo transportar"
          subtitle="Viajes, ofertas y tu ruta del día"
          onPress={() => choose("carrier")}
        />
      ) : null}
    </BottomSheetModal>
  );
}

function ReplayOption({
  testID,
  Icon,
  title,
  subtitle,
  onPress,
}: {
  testID: string;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3.5 rounded-2xl bg-bg-mute p-3.5"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-lime-500">
        <Icon size={18} strokeWidth={1.8} color="#0A0A0B" />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-sans-semibold text-[15px] text-fg">{title}</Text>
        <Text className="font-sans text-[13px] text-fg-2">{subtitle}</Text>
      </View>
    </Pressable>
  );
}
