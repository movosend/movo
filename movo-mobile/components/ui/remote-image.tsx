import { Image, type ImageContentFit } from "expo-image";
import { ImageOff } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { remoteImageSource, stableImageCacheKey } from "../../src/lib/remote-image";
import { SkeletonBlock } from "./skeleton-block";

type LoadState = "loading" | "loaded" | "error";

export interface RemoteImageProps {
  uri: string;
  /** Tamaño y forma del contenedor (width/height/borderRadius). El contenido se recorta a esa forma. */
  style: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  /** `skeleton` (default) para miniaturas y avatares; `spinner` sobre fondos oscuros (visor a pantalla completa). */
  loadingIndicator?: "skeleton" | "spinner";
  /** Qué mostrar si la imagen no se pudo bajar. Default: ícono de imagen rota. */
  fallback?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Imagen remota de la app: caché en memoria+disco con clave estable (una presigned URL
 * re-firmada no vuelve a bajar la foto), indicador mientras carga y fundido al aparecer,
 * en vez de un hueco vacío que se llena de golpe. Único punto de la app que carga
 * imágenes por red; las locales (fotos recién sacadas, assets empaquetados) siguen con
 * `Image` de React Native.
 */
export function RemoteImage({
  uri,
  style,
  contentFit = "cover",
  loadingIndicator = "skeleton",
  fallback,
  accessibilityLabel,
  testID,
}: RemoteImageProps) {
  const colors = useThemeColors();
  const cacheKey = stableImageCacheKey(uri);
  const [state, setState] = useState<LoadState>("loading");

  // Se reinicia solo si cambia la foto en sí, no la firma: re-firmar la misma foto en un
  // refetch no debe volver a mostrar el skeleton.
  useEffect(() => {
    setState("loading");
  }, [cacheKey]);

  return (
    // Fondo estático en modo skeleton: el skeleton se desmonta en `onLoad`, pero el
    // fundido de la imagen recién arranca ahí, y sin fondo se vería un frame vacío.
    <View
      testID={testID}
      className={loadingIndicator === "skeleton" ? "bg-bg-mute" : undefined}
      style={[styles.container, style]}
    >
      {state === "loading" ? (
        loadingIndicator === "skeleton" ? (
          <SkeletonBlock testID={testID ? `${testID}-loading` : undefined} style={StyleSheet.absoluteFill} />
        ) : (
          <View testID={testID ? `${testID}-loading` : undefined} style={[StyleSheet.absoluteFill, styles.center]}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )
      ) : null}
      {state === "error" ? (
        <View testID={testID ? `${testID}-error` : undefined} style={[StyleSheet.absoluteFill, styles.center]}>
          {fallback ?? <ImageOff size={18} strokeWidth={1.8} color={colors.fg3} />}
        </View>
      ) : (
        <Image
          testID={testID ? `${testID}-image` : undefined}
          source={remoteImageSource(uri)}
          recyclingKey={cacheKey}
          cachePolicy="memory-disk"
          contentFit={contentFit}
          transition={200}
          accessibilityLabel={accessibilityLabel}
          style={StyleSheet.absoluteFill}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: "hidden" },
  center: { alignItems: "center", justifyContent: "center" },
});
