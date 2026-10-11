import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { CircleCheck } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { capitalizeName } from "../../src/lib/profile-format";
import { AvatarImage } from "../ui/avatar-image";

interface ReceiverResultRowProps {
  profile: PublicProfile;
  onSelect: (profile: PublicProfile) => void;
  /** MOVO-275: motivo por el que esta persona no se puede elegir ("Es el emisor de este
   * envío"). Se muestra deshabilitada con el motivo en vez de ocultarla. */
  disabledReason?: string;
  testID?: string;
}

/** Fila de resultado de `GET /users/search` en el paso de receptor (AC4). Perfiles
 * con `isVerified === false` se muestran deshabilitados: el backend igual rechaza con
 * 422 `SHIPMENT_RECEIVER_KYC_NOT_APPROVED` al confirmar el envío — mejor prevenir el
 * callejón sin salida acá que dejar elegir y rebotar en el submit. */
export function ReceiverResultRow({ profile, onSelect, disabledReason, testID }: ReceiverResultRowProps) {
  const disabled = !profile.isVerified || !!disabledReason;

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={() => onSelect(profile)}
      className={`flex-row items-center gap-2.5 px-3.5 py-3 ${disabled ? "opacity-45" : ""}`}
    >
      <AvatarImage fullName={profile.fullName} photoUrl={profile.photoUrl} size={36} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-[14px] text-fg" numberOfLines={1}>
          {capitalizeName(profile.fullName)}
        </Text>
        {disabled ? (
          <Text testID={testID ? `${testID}-disabled-reason` : undefined} className="font-sans text-[12px] text-fg-3">
            {disabledReason ?? "Verificación pendiente"}
          </Text>
        ) : (
          <View className="flex-row items-center gap-1">
            <CircleCheck size={11} color="#2BB673" strokeWidth={2.5} />
            <Text className="font-sans text-[12px] text-fg-3">
              Identidad verificada
              {profile.reputationScore !== null ? ` · ★ ${profile.reputationScore.toFixed(1)}` : ""}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
