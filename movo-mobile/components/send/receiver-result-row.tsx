import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { CircleCheck } from "lucide-react-native";
import { Image, Pressable, Text, View } from "react-native";
import { capitalizeName } from "../../src/lib/profile-format";

interface ReceiverResultRowProps {
  profile: PublicProfile;
  onSelect: (profile: PublicProfile) => void;
  testID?: string;
}

function initials(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** Fila de resultado de `GET /users/search` en el paso de receptor (AC4). Perfiles
 * con `isVerified === false` se muestran deshabilitados: el backend igual rechaza con
 * 422 `SHIPMENT_RECEIVER_KYC_NOT_APPROVED` al confirmar el envío — mejor prevenir el
 * callejón sin salida acá que dejar elegir y rebotar en el submit. */
export function ReceiverResultRow({ profile, onSelect, testID }: ReceiverResultRowProps) {
  const disabled = !profile.isVerified;

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={() => onSelect(profile)}
      className={`flex-row items-center gap-2.5 px-3.5 py-3 ${disabled ? "opacity-45" : ""}`}
    >
      <View className="h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-bg-mute">
        {profile.photoUrl ? (
          <Image source={{ uri: profile.photoUrl }} className="h-full w-full" resizeMode="cover" />
        ) : (
          <Text className="font-sans-semibold text-[12px] text-fg-2">{initials(profile.fullName)}</Text>
        )}
      </View>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[14px] text-fg" numberOfLines={1}>
          {capitalizeName(profile.fullName)}
        </Text>
        {disabled ? (
          <Text className="font-sans text-[12px] text-fg-3">Verificación pendiente</Text>
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
