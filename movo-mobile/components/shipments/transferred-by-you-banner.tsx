import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import { ArrowLeftRight } from "lucide-react-native";
import { Text, View } from "react-native";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { formatTransferDate } from "../../src/lib/receiver-transfer-format";
import { AvatarImage } from "../ui/avatar-image";

interface TransferredByYouBannerProps {
  transfer: ReceiverTransferRequest;
  testID?: string;
}

/**
 * MOVO-275 (decisión del equipo, ADR-037): el receptor que le pasó la recepción a otra
 * persona sigue viendo el envío completo en solo lectura. Este banner va arriba del
 * detalle y dice a quién se lo pasó, cuándo y por qué. Colores fijos (`ink-950`/
 * blanco): la card es oscura en los dos temas, mismo criterio que la card de precio
 * sugerido del transportista.
 */
export function TransferredByYouBanner({ transfer, testID }: TransferredByYouBannerProps) {
  const { data: newReceiver } = usePublicProfile(transfer.newReceiverId);
  const name = newReceiver?.fullName ?? transfer.newReceiverName ?? "otra persona";
  const when = formatTransferDate(transfer.resolvedAt ?? transfer.createdAt);

  return (
    <View testID={testID} className="gap-3 rounded-[14px] bg-ink-950 px-4 py-4">
      <View className="flex-row items-center gap-3">
        <View>
          <AvatarImage fullName={name} photoUrl={newReceiver?.photoUrl ?? null} size={44} />
          <View className="absolute -bottom-1 -right-1 h-6 w-6 items-center justify-center rounded-full bg-paper">
            <ArrowLeftRight size={13} color="#0A0A0B" strokeWidth={2.2} />
          </View>
        </View>
        <View className="flex-1 gap-0.5">
          <Text testID={testID ? `${testID}-title` : undefined} className="font-sans-semibold text-body text-paper">
            Le pasaste la recepción a {name}
          </Text>
          {when ? <Text className="font-sans text-small text-ink-300">Aceptó el {when}</Text> : null}
        </View>
      </View>
      {transfer.reason ? (
        <Text
          testID={testID ? `${testID}-reason` : undefined}
          className="rounded-[10px] bg-ink-800 px-3 py-2.5 font-sans text-small text-ink-200"
        >
          “{transfer.reason}”
        </Text>
      ) : null}
      <Text className="font-sans text-small text-ink-300">
        Ves este envío en modo lectura. {name.split(" ")[0]} lo recibe en la misma dirección y firma la entrega con el
        transportista.
      </Text>
    </View>
  );
}
