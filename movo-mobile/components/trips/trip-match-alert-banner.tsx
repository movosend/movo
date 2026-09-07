import { BlurView } from "expo-blur";
import { router, usePathname } from "expo-router";
import * as Haptics from "expo-haptics";
import { Package, X } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AvailableShipmentCard } from "../transport/available-shipment-card";
import { useActiveTripMatchAlert, type TripMatchAlert } from "../../src/hooks/use-active-trip-match-alert";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const CARD_MARGIN = 16;

/**
 * Aviso global de matches pendientes (MOVO-163, extensión de alcance "tipo Uber"): a
 * diferencia de todos los banners existentes del repo (`SuccessBanner`/`ErrorBanner`),
 * este tiene que verse sin importar en qué pantalla está el usuario — no es un
 * componente embebido en una screen, es un overlay montado una sola vez en
 * `app/(app)/_layout.tsx`, hermano superpuesto del `<Stack>`.
 *
 * Reusa `AvailableShipmentCard` tal cual (no se duplica esa UI, AC3) — tocarla ya
 * navega al detalle (`/transport/:id`, MOVO-166), donde vive "Hacer una oferta"
 * (MOVO-149). Feedback post-implementación, varias rondas:
 *
 * 1. Se sacaron los botones "Aceptar"/"Rechazar" de una versión anterior: en vez de
 *    eso, con más de un match pendiente se recorren con un carrusel swipeable
 *    horizontal (mismo patrón de `FlatList` paginado de `PhotoViewerModal`,
 *    MOVO-127 — `pagingEnabled` + `getItemLayout` + `onMomentumScrollEnd` para el
 *    índice actual), con un contador "N/M" en el header y puntos de página debajo
 *    (`trip-match-alert-dots`, feedback: "que sea más intuitivo desplazar" — sin
 *    ellos no había ninguna pista visual de que la card fuera swipeable). "Ver
 *    envío" navega al del ítem actualmente enfocado del carrusel (`carouselIndex`).
 *    A diferencia del feed de MOVO-148 (donde tocar la card SÍ navega, AC9), acá la
 *    card va con `interactive={false}` (prop nueva de `AvailableShipmentCard`,
 *    default `true` — no afecta a `transport.tsx`): tocarla no hace nada, el detalle
 *    se ve únicamente apretando "Ver envío" — pedido explícito del usuario, la card
 *    ocupando casi todo el ancho del carrusel competía con el gesto de swipe (tocar
 *    para navegar vs. arrastrar para pasar de página). El botón lleva el mismo
 *    efecto de press que el resto de los botones "principales" del repo
 *    (`PrimaryButton`, `ReceiverActionsBar`): `active:opacity-80` +
 *    `Haptics.impactAsync(ImpactFeedbackStyle.Light)`. Decidir "aceptar" un envío
 *    sigue siendo, como en el resto de la app, entrar a su detalle y ofertar ahí
 *    (MOVO-149) — no hay un "aceptar" de un tap sin pasar por esa pantalla.
 * 2. **Se oculta mientras se está viendo el detalle de un envío** (`/transport/:id`,
 *    vía `usePathname()`): entrar a revisar un envío no debería competir
 *    visualmente con la card flotante encima. No es un descarte (`dismiss()`) — el
 *    mismo `alert` sigue vivo en memoria y la card reaparece sola apenas se vuelve a
 *    cualquier otra pantalla, sin re-consultar el backend.
 *
 * **`Modal` + `useSheetAnimation`** (feedback de una ronda anterior): la v1 era un
 * `View` absolutamente posicionado sin backdrop — el contenido de la pantalla de
 * atrás se veía sangrando alrededor de la card, muy amontonado. Usa el mismo patrón
 * de `Modal` transparente + `useSheetAnimation` que ya usan todos los sheets del pie
 * de pantalla del repo (`ReceiverActionsBar`, MOVO-131), con un backdrop propio que
 * blurrea y oscurece TODO el fondo (no solo el recorte de la card) — tocar el
 * backdrop descarta, mismo criterio que el modal de rechazo de `ReceiverActionsBar`.
 * Ancla abajo, sobre `FloatingTabBar` (MOVO-78): `insets.bottom + 84` deja lugar para
 * sus 60px de alto + 12px de margen, más un gap de 12px.
 *
 * Sin auto-dismiss: con una card accionable que pide una decisión real (ver/
 * ofertar), no un aviso de paso, hacerla desaparecer sola podría esconder un envío
 * disponible antes de que el usuario llegue a leerlo.
 */
export function TripMatchAlertBanner() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const pathname = usePathname();
  const { alert, dismiss } = useActiveTripMatchAlert();
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(!!alert);
  const [carouselIndex, setCarouselIndex] = useState(0);

  // Mantiene el último alert mostrado durante la animación de cierre: `alert` ya es
  // `null` apenas se descarta, pero `isMounted` sigue `true` unos ms más mientras la
  // hoja termina de deslizarse hacia abajo — sin esto, el contenido desaparecería de
  // un salto a mitad de esa animación.
  const [displayAlert, setDisplayAlert] = useState<TripMatchAlert | null>(null);
  useEffect(() => {
    if (alert) {
      setDisplayAlert(alert);
      setCarouselIndex(0);
    }
  }, [alert]);

  // Oculta (sin descartar) mientras se ve el detalle de un envío — ver punto 2 del
  // comentario de arriba.
  const isViewingShipmentDetail = pathname?.startsWith("/transport/") ?? false;

  if (!isMounted || !displayAlert || isViewingShipmentDetail) return null;

  const cardWidth = windowWidth - CARD_MARGIN * 2;
  const { shipments } = displayAlert;
  const message = shipments.length === 1 ? "1 paquete compatible con tu viaje" : `${shipments.length} paquetes compatibles con tu viaje`;

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={dismiss}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable testID="trip-match-alert-backdrop" onPress={dismiss} style={{ flex: 1 }}>
            <BlurView
              intensity={isDark ? 35 : 45}
              tint={isDark ? "dark" : "light"}
              blurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
              style={StyleSheet.absoluteFill}
            />
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(10,10,11,0.35)" : "rgba(10,10,11,0.12)" },
              ]}
            />
          </Pressable>
        </Animated.View>

        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            justifyContent: "flex-end",
            paddingHorizontal: CARD_MARGIN,
            paddingBottom: insets.bottom + 84,
          }}
        >
          <Animated.View style={sheetStyle}>
            <View
              style={{
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1.5,
                borderColor: "#C6F24A",
                backgroundColor: isDark ? "#0A0A0B" : "#FFFFFF",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: isDark ? 0.45 : 0.16,
                shadowRadius: 24,
                elevation: 14,
              }}
            >
              <View className="gap-3 pb-4 pt-4">
                <View className="flex-row items-center gap-3 px-4">
                  <View className="h-12 w-12 items-center justify-center rounded-full bg-lime-500">
                    <Package size={24} color="#0A0A0B" strokeWidth={2} />
                  </View>
                  <Text className="flex-1 font-sans-semibold text-body text-fg" numberOfLines={2}>
                    {message}
                  </Text>
                  {shipments.length > 1 ? (
                    <Text testID="trip-match-alert-counter" className="font-sans-medium text-small text-fg-3">
                      {carouselIndex + 1}/{shipments.length}
                    </Text>
                  ) : null}
                  <Pressable testID="trip-match-alert-dismiss" onPress={dismiss} hitSlop={8}>
                    <X size={18} color={colors.fg3} strokeWidth={2} />
                  </Pressable>
                </View>

                {/* Separador entre el header y el contenido del envío: la card de
                    adentro es `bare` (sin su propio borde/fondo, ver el comentario de
                    `AvailableShipmentCard`) para no leerse como una card dentro de
                    otra card — esta línea reemplaza a ese borde como el único
                    quiebre visual entre las dos secciones. */}
                <View className="mx-4 border-t border-border" />

                <FlatList
                  testID="trip-match-alert-carousel"
                  data={shipments}
                  keyExtractor={(item) => item.id}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  style={{ width: cardWidth }}
                  getItemLayout={(_, i) => ({ length: cardWidth, offset: cardWidth * i, index: i })}
                  onMomentumScrollEnd={(event) => {
                    setCarouselIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth));
                  }}
                  renderItem={({ item }) => (
                    <View style={{ width: cardWidth, paddingHorizontal: 16 }}>
                      <AvailableShipmentCard
                        shipment={item}
                        bare
                        interactive={false}
                        testID={`trip-match-alert-shipment-card-${item.id}`}
                      />
                    </View>
                  )}
                />

                {shipments.length > 1 ? (
                  <View testID="trip-match-alert-dots" className="flex-row items-center justify-center gap-1.5">
                    {shipments.map((item, i) => (
                      <View
                        key={item.id}
                        testID={`trip-match-alert-dot-${i}`}
                        className={`h-1.5 rounded-full ${i === carouselIndex ? "w-4 bg-lime-500" : "w-1.5 bg-bg-mute"}`}
                      />
                    ))}
                  </View>
                ) : null}

                <Pressable
                  testID="trip-match-alert-view"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(`/transport/${shipments[carouselIndex].id}`);
                  }}
                  className="mx-4 items-center justify-center rounded-lg bg-lime-500 py-3.5 active:opacity-80"
                >
                  <Text className="font-sans-semibold text-body text-ink-950">Ver envío</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
