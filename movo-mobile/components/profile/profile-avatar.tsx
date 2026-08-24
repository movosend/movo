import { Image, Text, View } from "react-native";
import { getInitials } from "../../src/lib/profile-format";

export interface ProfileAvatarProps {
  fullName: string;
  photoUrl: string | null;
  size?: number;
  testID?: string;
}

/**
 * Avatar con foto o iniciales de fallback. Props compatibles con `PublicProfile`
 * (solo usa `fullName`/`photoUrl`, presentes en ambas proyecciones) — pensado para
 * que la futura pantalla de perfil público de otro usuario (MOVO-17, no se construye
 * acá) pueda reusarlo sin cambios.
 *
 * Sin affordance de edición/tap a propósito: la subida de foto (MOVO-97/98) todavía
 * no arrancó — este componente queda como la pieza aislada que ese ticket va a envolver
 * en un `Pressable` cuando corresponda, sin tener que reescribirlo.
 */
export function ProfileAvatar({ fullName, photoUrl, size = 56, testID }: ProfileAvatarProps) {
  if (photoUrl) {
    return (
      <Image
        testID={testID}
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  return (
    <View
      testID={testID}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-fg"
    >
      <Text
        style={{ fontSize: size * 0.36 }}
        className="font-sans-semibold text-bg"
      >
        {getInitials(fullName)}
      </Text>
    </View>
  );
}
