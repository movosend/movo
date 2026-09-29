import { Text, View } from "react-native";
import { getInitials } from "../../src/lib/profile-format";
import { RemoteImage } from "./remote-image";

interface AvatarImageProps {
  fullName: string;
  photoUrl: string | null;
  size?: number;
  testID?: string;
}

function AvatarInitials({ fullName, size, testID }: { fullName: string; size: number; testID?: string }) {
  return (
    <View
      testID={testID}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-bg-mute"
    >
      <Text style={{ fontSize: size * 0.32 }} className="font-sans-semibold text-fg-2">
        {getInitials(fullName)}
      </Text>
    </View>
  );
}

/**
 * Avatar circular con skeleton mientras la foto carga (MOVO-83) — selector de receptor y
 * contrapartes del detalle de envío. Sin `photoUrl` va directo a las iniciales; si la
 * foto falla, también cae a las iniciales en vez de un ícono de imagen rota.
 */
export function AvatarImage({ fullName, photoUrl, size = 36, testID }: AvatarImageProps) {
  if (!photoUrl) {
    return <AvatarInitials fullName={fullName} size={size} testID={testID} />;
  }

  return (
    <RemoteImage
      testID={testID}
      uri={photoUrl}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      fallback={<AvatarInitials fullName={fullName} size={size} />}
    />
  );
}
