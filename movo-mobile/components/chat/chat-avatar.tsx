import { Text, View } from "react-native";
import { getInitials } from "../../src/lib/profile-format";
import { RemoteImage } from "../ui/remote-image";

/**
 * Avatar del chat tal cual el prototipo: círculo `bg-mute` con las iniciales en `fg-2`
 * (600, ~1/3 del tamaño) o la foto de perfil si la tiene. Distinto de `ProfileAvatar`, que usa
 * el círculo invertido (`bg-fg`) del resto de la app.
 */
export function ChatAvatar({
  fullName,
  photoUrl,
  size,
  fontSize,
  testID,
}: {
  fullName: string;
  photoUrl: string | null;
  size: number;
  fontSize: number;
  testID?: string;
}) {
  const initials = (
    <View testID={testID} style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-bg-mute">
      <Text style={{ fontSize }} className="font-sans-semibold text-fg-2">
        {getInitials(fullName)}
      </Text>
    </View>
  );
  if (!photoUrl) return initials;
  return (
    <RemoteImage
      uri={photoUrl}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      fallback={initials}
    />
  );
}
