import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { UserRound } from "lucide-react-native";
import { Text, View } from "react-native";
import { useShipmentWizardStore } from "../../../src/store/shipment-wizard-store";
import { ReceiverSearchField } from "../receiver-search-field";

/** AC4: búsqueda de receptor con confirmación explícita de la selección. */
export function isReceiverStepValid(state: { receiver: PublicProfile | null }): boolean {
  return state.receiver !== null && state.receiver.isVerified;
}

export function ReceiverStep() {
  const { receiver, setReceiver } = useShipmentWizardStore();

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <UserRound size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">¿Quién lo recibe?</Text>
        <Text className="font-sans text-body text-fg-2">
          Buscá por nombre y apellido, y confirmá al receptor.
        </Text>
      </View>

      <ReceiverSearchField
        testID="receiver-step-search"
        selected={receiver}
        onSelect={setReceiver}
        onClear={() => setReceiver(null)}
      />
    </View>
  );
}
