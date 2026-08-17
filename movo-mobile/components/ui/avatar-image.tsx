import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { getInitials } from "../../src/lib/profile-format";
import { SkeletonBlock } from "./skeleton-block";

interface AvatarImageProps {
  fullName: string;
  photoUrl: string | null;
  size?: number;
  testID?: string;
}

/**
 * Avatar circular con skeleton mientras la foto carga (MOVO-83, feedback de UI: la
 * foto de perfil del receptor podía tardar unos segundos en aparecer y quedaba un
 * hueco vacío/brusco hasta que resolvía) — usado en el selector de receptor
 * (`receiver-result-row.tsx`/`receiver-search-field.tsx`). Sin `photoUrl` no hay nada
 * que cargar, va directo a las iniciales sin pasar por el skeleton.
 */
export function AvatarImage({ fullName, photoUrl, size = 36, testID }: AvatarImageProps) {
  const [loaded, setLoaded] = useState(false);

  // Reinicia el estado de carga si cambia la foto (p.ej. otro resultado de búsqueda) —
  // sin esto, un componente reusado por una lista con `key` estable mostraría la foto
  // vieja "cargada" superpuesta a la nueva mientras la nueva todavía está en vuelo.
  useEffect(() => {
    setLoaded(false);
  }, [photoUrl]);

  if (!photoUrl) {
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

  return (
    <View
      testID={testID}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="relative overflow-hidden"
    >
      {loaded ? null : <SkeletonBlock className="absolute inset-0" />}
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size }}
        resizeMode="cover"
        onLoadEnd={() => setLoaded(true)}
      />
    </View>
  );
}
