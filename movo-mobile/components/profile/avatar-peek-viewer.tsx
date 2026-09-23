import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { useColorScheme } from "nativewind";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { ProfileAvatar } from "./profile-avatar";

// Tamaño objetivo del peek — capado por el ancho real de pantalla (`computePeekGeometry`
// lo achica si no entra) para que en un teléfono angosto siga dejando `PEEK_MARGIN` de
// aire a cada lado.
const PEEK_SIZE_MAX = 320;
const PEEK_MARGIN = 24;
// Más breve que el long-press default de `Pressable` (500ms) — mismo criterio que el
// peek de historias/avatar de Instagram, que se siente casi inmediato al apretar.
const PEEK_DELAY_MS = 220;
const PEEK_OPEN_DURATION_MS = 220;
const PEEK_CLOSE_DURATION_MS = 160;

export interface PeekGeometry {
  left: number;
  top: number;
  size: number;
  originOffsetX: number;
  originOffsetY: number;
  originScale: number;
}

interface AvatarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenBounds {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
}

/**
 * El peek queda SIEMPRE centrado en pantalla (horizontal y vertical, dentro del área
 * segura) — pedido explícito del usuario, mismo lenguaje que el preview de foto de
 * perfil de Instagram/WhatsApp, nunca "cerca de donde estaba el avatar". Devuelve
 * también los offsets de origen (relativos a ese centro) para que la animación de
 * apertura arranque en la posición y tamaño reales del avatar. Pura y testeable aparte
 * de la mecánica de gesto/`Animated` en sí (mismo criterio ya aceptado en el repo para
 * `ZoomableImage`/`PhotoViewerModal`: la mecánica de gesto se prueba a mano en device,
 * la geometría se prueba unitariamente).
 */
export function computePeekGeometry(rect: AvatarRect, bounds: ScreenBounds): PeekGeometry {
  const size = Math.min(PEEK_SIZE_MAX, bounds.width - PEEK_MARGIN * 2);
  const half = size / 2;
  const originCenterX = rect.x + rect.width / 2;
  const originCenterY = rect.y + rect.height / 2;

  const safeTop = bounds.insetTop;
  const safeBottom = bounds.height - bounds.insetBottom;
  const targetCenterX = bounds.width / 2;
  const targetCenterY = safeTop + (safeBottom - safeTop) / 2;

  return {
    left: targetCenterX - half,
    top: targetCenterY - half,
    size,
    originOffsetX: originCenterX - targetCenterX,
    originOffsetY: originCenterY - targetCenterY,
    originScale: rect.width / size,
  };
}

export interface AvatarPeekViewerProps {
  fullName: string;
  photoUrl: string | null;
  size?: number;
  testID?: string;
}

/**
 * Avatar con "peek" al mantener presionado: la foto se agranda con máscara circular,
 * animada desde la posición/tamaño real del avatar hacia el centro exacto de la
 * pantalla (horizontal y vertical, nunca cerca de donde estaba el avatar — pedido
 * explícito de UX), y queda abierta hasta que se toca fuera de ella — mismo lenguaje
 * que el preview de foto de perfil de Instagram/WhatsApp (abrís con el gesto, cerrás
 * tocando afuera, no mientras mantenés presionado).
 *
 * Reemplaza el `PhotoViewerModal` (visor de pantalla completa con swipe/pinch entre
 * varias fotos, pensado para evidencia de envío) que `profile.tsx`/`profile/[id].tsx`
 * reusaban para este mismo gesto — ambos duplicaban la misma lógica de
 * long-press+haptics+estado (MOVO-244 review, PR #184).
 *
 * **`Modal` + `useSheetAnimation`, no un overlay hermano absoluto** (fix de feedback:
 * la primera versión era un `View pointerEvents="none"` posicionado dentro del propio
 * árbol de la pantalla — sin un `Modal` real, el orden de pintado de RN es por
 * posición en el árbol, no por z-index, así que cualquier contenido hermano que
 * viniera DESPUÉS en el JSX de la pantalla (otra sección de la card, por ejemplo)
 * pintaba encima del peek en vez de quedar debajo). El `Modal` transparente garantiza
 * que el peek se pinte sobre TODO, sin importar dónde vive `AvatarPeekViewer` en el
 * árbol — mismo patrón ya usado en el repo para overlays de pantalla completa
 * (`TripMatchAlertBanner`, `select-field.tsx`). El backdrop blurrea y oscurece la
 * pantalla completa (`BlurView` + velo oscuro, mismo armado que `TripMatchAlertBanner`)
 * y tocarlo cierra el peek — tocar la foto en sí no (`Pressable` propio que absorbe el
 * toque, mismo criterio que el contenido de cualquier sheet del repo).
 *
 * El `scale` siempre se mantiene 1:1 sobre un círculo — nunca se anima
 * `borderRadius`/`width`/`height` a la vez (evita el bug de esquinas cuadradas en
 * Android ya documentado en `vehicle-info.tsx`, MOVO-223).
 */
export function AvatarPeekViewer({ fullName, photoUrl, size = 56, testID }: AvatarPeekViewerProps) {
  const avatarRef = useRef<View>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<PeekGeometry | null>(null);
  const { isMounted, backdropStyle } = useSheetAnimation(open);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const openPeek = useCallback(() => {
    avatarRef.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return;

      const geometry = computePeekGeometry(
        { x, y, width, height },
        { width: screenWidth, height: screenHeight, insetTop: insets.top, insetBottom: insets.bottom },
      );

      // Arranca exactamente en la posición/tamaño real del avatar, antes de que
      // `useEffect` dispare la animación hacia el centro — sin esto se vería un
      // salto de un frame entre el avatar real y el punto de partida del peek.
      translateX.value = geometry.originOffsetX;
      translateY.value = geometry.originOffsetY;
      scale.value = geometry.originScale;
      setPeek(geometry);
      setOpen(true);

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    });
  }, [insets.bottom, insets.top, scale, screenHeight, screenWidth, translateX, translateY]);

  const closePeek = useCallback(() => setOpen(false), []);

  // Anima según `open`, no según `isMounted` del sheet (que se demora un frame extra
  // en `useSheetAnimation`) — necesita el `peek` más reciente para volver a SU offset
  // de origen exacto, así que `peek` queda fuera de las deps a propósito (se lee por
  // clausura del último valor asignado, igual que ya documenta `useSheetAnimation`).
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        translateX.value = withTiming(0, { duration: PEEK_OPEN_DURATION_MS });
        translateY.value = withTiming(0, { duration: PEEK_OPEN_DURATION_MS });
        scale.value = withTiming(1, { duration: PEEK_OPEN_DURATION_MS });
      });
      return () => cancelAnimationFrame(raf);
    }
    if (peek) {
      translateX.value = withTiming(peek.originOffsetX, { duration: PEEK_CLOSE_DURATION_MS });
      translateY.value = withTiming(peek.originOffsetY, { duration: PEEK_CLOSE_DURATION_MS });
      scale.value = withTiming(peek.originScale, { duration: PEEK_CLOSE_DURATION_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const peekAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!photoUrl) {
    return <ProfileAvatar testID={testID} fullName={fullName} photoUrl={photoUrl} size={size} />;
  }

  return (
    <>
      <Pressable
        testID={testID ? `${testID}-button` : undefined}
        onLongPress={openPeek}
        delayLongPress={PEEK_DELAY_MS}
        accessibilityRole="button"
        accessibilityLabel="Mantener presionado para ver la foto de perfil ampliada"
        hitSlop={8}
      >
        <View ref={avatarRef} collapsable={false}>
          <ProfileAvatar testID={testID} fullName={fullName} photoUrl={photoUrl} size={size} />
        </View>
      </Pressable>

      <Modal visible={isMounted} animationType="none" transparent onRequestClose={closePeek}>
        <View style={{ flex: 1 }}>
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              testID={testID ? `${testID}-peek-backdrop` : undefined}
              style={{ flex: 1 }}
              onPress={closePeek}
              accessibilityRole="button"
              accessibilityLabel="Cerrar la foto de perfil ampliada"
            >
              <BlurView
                intensity={isDark ? 50 : 60}
                tint={isDark ? "dark" : "light"}
                blurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
                style={StyleSheet.absoluteFill}
              />
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,11,0.55)" }]}
              />
            </Pressable>
          </Animated.View>

          {peek ? (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <Animated.View
                testID={testID ? `${testID}-peek-image` : undefined}
                style={[
                  { position: "absolute", left: peek.left, top: peek.top, width: peek.size, height: peek.size },
                  peekAnimatedStyle,
                ]}
              >
                {/* `Pressable` propio (no-op): absorbe el toque para que tocar la foto
                    no cierre el peek — solo el backdrop de atrás lo cierra. */}
                <Pressable onPress={() => {}}>
                  <Image
                    source={{ uri: photoUrl }}
                    style={{ width: peek.size, height: peek.size, borderRadius: peek.size / 2 }}
                    resizeMode="cover"
                  />
                </Pressable>
              </Animated.View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
