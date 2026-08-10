import { BlurView } from "expo-blur";
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { useColorScheme } from "nativewind";
import { Platform, View } from "react-native";
import { TAB_BAR_ITEMS } from "./tab-config";
import { TabBarButton } from "./tab-bar-button";

const HORIZONTAL_MARGIN = 20;
const BOTTOM_MARGIN = 12;
const BAR_HEIGHT = 60;
const BAR_RADIUS = BAR_HEIGHT / 2;

/**
 * Tab bar flotante y "glassy" (MOVO-78): pill redondeada, separada de los bordes de
 * la pantalla, con blur de fondo. Se pasa como `tabBar` custom a `<Tabs>` de
 * expo-router (`app/(app)/(tabs)/_layout.tsx`) — recibe la firma estándar de
 * `BottomTabBarProps` de React Navigation (`state`/`descriptors`/`navigation`/
 * `insets`), que expo-router re-expone tal cual bajo `expo-router/build/react-navigation/bottom-tabs`.
 *
 * No usa `SafeAreaView`: la barra tiene que *flotar sobre* el contenido de cada
 * screen, no empujarlo — el margen inferior se calcula a mano con `insets.bottom`
 * (ya viene en las props, no hace falta `useSafeAreaInsets()` aparte).
 *
 * Reescrito tras feedback de que se veía "borrosa y mal renderizada" en dispositivo
 * real: `expo-blur` en Android con `blurMethod="none"` (el default) no hace blur de
 * verdad, solo pinta una superficie
 * semitransparente lisa que deja *literalmente* el contenido de atrás sin difuminar —
 * de ahí el degradé feo (era el fondo real de la pantalla transparentándose sin
 * ningún blur). Con el método experimental, Android usa la librería nativa de
 * Dimezis y sí produce blur real. En iOS se usan los materiales del sistema
 * (`systemUltraThinMaterial*`), más fieles al look de Liquid Glass que el `tint`
 * genérico `"light"/"dark"` usado antes.
 *
 * Los 3 `TabBarButton` reparten el ancho completo de la fila en partes iguales
 * (`flex: 1` en cada uno, ver `tab-bar-button.tsx`) — variante "expandable" (pill que
 * crecía con el label) descartada por feedback de que no se sentía intuitiva.
 */
export function FloatingTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: HORIZONTAL_MARGIN,
        right: HORIZONTAL_MARGIN,
        bottom: insets.bottom + BOTTOM_MARGIN,
      }}
    >
      {/*
       * Wrapper de sombra SIN `overflow: hidden`: la sombra (iOS `shadow*` / Android
       * `elevation`) se recorta si el propio View la clipea — el blur y el redondeo
       * de esquinas viven en el View de adentro, separado a propósito.
       */}
      <View
        style={{
          borderRadius: BAR_RADIUS,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: isDark ? 0.45 : 0.12,
          shadowRadius: 20,
          elevation: 12,
        }}
      >
        <View
          style={{
            height: BAR_HEIGHT,
            borderRadius: BAR_RADIUS,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.6)",
          }}
        >
          <BlurView
            intensity={isDark ? 45 : 70}
            tint={
              Platform.OS === "ios"
                ? isDark
                  ? "systemUltraThinMaterialDark"
                  : "systemUltraThinMaterialLight"
                : isDark
                  ? "dark"
                  : "light"
            }
            blurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          {/*
           * Capa de tinte sutil sobre el blur: aporta contraste consistente entre
           * plataformas (el blur nativo de iOS y el de Dimezis en Android no rinden
           * exactamente la misma opacidad) sin taparlo — es la diferencia entre un
           * "glass" translúcido intencional y una superficie opaca lisa.
           */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: isDark ? "rgba(10,10,11,0.4)" : "rgba(255,255,255,0.45)",
            }}
          />
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 6,
            }}
          >
            {state.routes.map((route, index) => {
              const config = TAB_BAR_ITEMS.find((item) => item.name === route.name);
              if (!config) return null;

              const isFocused = state.index === index;

              function handlePress() {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }

              return (
                <TabBarButton
                  key={route.key}
                  testID={`tab-bar-button-${config.name}`}
                  label={config.label}
                  Icon={config.Icon}
                  isFocused={isFocused}
                  onPress={handlePress}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}
