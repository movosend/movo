import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { MapPin } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { movoMapStyleDark, movoMapStyleLight } from "../../src/constants/map-style";
import { useCreateAddress } from "../../src/hooks/use-addresses";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { addressSelectionToCreateInput } from "../../src/lib/address-selection-to-input";
import type { AddressSelection } from "../../src/types/address-selection";
import { ErrorBanner } from "../ui/error-banner";

// Alto aproximado de la card + botón flotantes de abajo — se lo pasamos a
// `MapView#mapPadding` para que el atributo "Google" (obligatorio, no se puede sacar
// ni mover a mano) se reacomode arriba de nuestra UI en vez de quedar tapado/pegado
// contra el borde inferior de la pantalla.
const BOTTOM_OVERLAY_HEIGHT = 150;

// Mismo fallback que `address-search-sheet.tsx`/`edit-address-sheet.tsx`.
const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const SAVE_ERROR = "No pudimos guardar la dirección. Probá de nuevo.";

interface ConfirmAddAddressSheetProps {
  visible: boolean;
  selection: AddressSelection | null;
  onClose: () => void;
  onSaved: () => void;
  testID?: string;
}

/**
 * Paso de confirmación entre elegir una dirección en `AddressSearchSheet` y guardarla
 * de verdad (MOVO-121, fix de feedback): antes se guardaba automáticamente al elegir
 * de la lista, sin mostrar nunca el mapa para ajustar el pin y sin mostrar el error de
 * guardado en el contexto correcto (quedaba oculto detrás del `Modal` del buscador,
 * solo visible si el usuario cerraba el buscador a mano).
 *
 * Mapa a pantalla completa (pedido explícito, más impactante que el `CollapsibleMapRow`
 * fijo de `address-field.tsx`): el header flota sobre el `MapView` con `BlurView`
 * (mismo lenguaje "glassy" que `FloatingTabBar`, MOVO-78); la card de dirección y el
 * botón de abajo van sin blur/fondo (pedido explícito, "fondo transparente"), cada
 * uno con su propia drop shadow liviana en vez de un contenedor compartido con
 * línea divisoria. `MapView`/`Marker` se arman a mano acá (no `CollapsibleMapRow`,
 * pensado para una fila colapsable de alto fijo, no para ocupar toda la pantalla).
 * `mapPadding` empuja el atributo "Google" (obligatorio) arriba de la card/botón
 * flotantes, para que no quede tapado ni pegado contra el borde inferior.
 *
 * El body vive en `ConfirmAddAddressBody`, remontado con un `key` derivado de la
 * selección: el `Modal` de RN nunca desmonta sus hijos entre aperturas (solo los
 * oculta) — sin este remount, `MapView#initialRegion` (que solo se lee al montar)
 * quedaba congelado en la primera dirección que se había abierto, así que el mapa
 * mostraba siempre esa mientras el usuario buscaba direcciones nuevas.
 */
export function ConfirmAddAddressSheet({
  visible,
  selection,
  onClose,
  onSaved,
  testID,
}: ConfirmAddAddressSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        {selection ? (
          <ConfirmAddAddressBody
            key={`${selection.lat}-${selection.lng}-${selection.address}`}
            selection={selection}
            onClose={onClose}
            onSaved={onSaved}
            testID={testID}
          />
        ) : null}
      </SafeAreaProvider>
    </Modal>
  );
}

function ConfirmAddAddressBody({
  selection,
  onClose,
  onSaved,
  testID,
}: {
  selection: AddressSelection;
  onClose: () => void;
  onSaved: () => void;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = useThemeColors();
  const createAddress = useCreateAddress();
  const [lat, setLat] = useState(selection.lat);
  const [lng, setLng] = useState(selection.lng);
  const [error, setError] = useState<string | null>(null);

  const region: Region = {
    latitude: lat,
    longitude: lng,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  const handleSave = async () => {
    setError(null);
    try {
      await createAddress.mutateAsync(
        addressSelectionToCreateInput({ ...selection, lat, lng }),
      );
      onSaved();
    } catch {
      setError(SAVE_ERROR);
    }
  };

  const blurTint = Platform.OS === "ios"
    ? isDark
      ? "systemUltraThinMaterialDark"
      : "systemUltraThinMaterialLight"
    : isDark
      ? "dark"
      : "light";
  const blurMethod = Platform.OS === "android" ? "dimezisBlurView" : "none";

  return (
    <View className="flex-1 bg-bg">
      <MapView
        testID={testID ? `${testID}-map` : undefined}
        provider={PROVIDER_GOOGLE}
        customMapStyle={isDark ? movoMapStyleDark : movoMapStyleLight}
        style={{ flex: 1 }}
        initialRegion={region}
        mapPadding={{
          top: 0,
          right: 0,
          bottom: BOTTOM_OVERLAY_HEIGHT + insets.bottom,
          // Alinea el atributo "Google" con el `px-5` (20px) de la card/botón de
          // abajo, en vez de quedar pegado al borde izquierdo de la pantalla.
          left: 20,
        }}
      >
        <Marker
          testID={testID ? `${testID}-marker` : undefined}
          coordinate={{ latitude: lat, longitude: lng }}
          draggable
          anchor={{ x: 0.5, y: 1 }}
          onDragEnd={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setLat(latitude);
            setLng(longitude);
          }}
        >
          <View
            style={{
              paddingTop: 12,
              paddingHorizontal: 12,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 3,
              elevation: 4,
            }}
          >
            <MapPin size={44} strokeWidth={1.5} color="#1A1A1D" fill="#C6F24A" />
          </View>
        </Marker>
      </MapView>

      {/* Header flotante sobre el mapa, mismo lenguaje "glassy" que FloatingTabBar */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden" }}>
        <BlurView
          intensity={isDark ? 45 : 70}
          tint={blurTint}
          blurMethod={blurMethod}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: isDark ? "rgba(10,10,11,0.4)" : "rgba(255,255,255,0.55)",
          }}
        />
        <View
          className="flex-row items-center px-5 pb-3"
          style={{ paddingTop: insets.top + 8 }}
        >
          <Text className="flex-1 font-sans-semibold text-h3 text-fg">
            Confirmar dirección
          </Text>
          <Pressable
            testID={testID ? `${testID}-close` : undefined}
            onPress={onClose}
            hitSlop={8}
          >
            <Text className="font-sans-medium text-[13px] text-fg-3">Cancelar</Text>
          </Pressable>
        </View>
      </View>

      {/* Hint flotante, mismo criterio que el que tenía `CollapsibleMapRow` */}
      <View
        pointerEvents="none"
        className="absolute left-3 right-3 items-center"
        style={{ top: insets.top + 64 }}
      >
        <View
          className="rounded-full border border-border bg-bg px-3.5 py-1.5"
          style={{
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
          }}
        >
          <Text className="font-sans-medium text-[12px] text-fg-2">
            Arrastrá el pin para ajustar la ubicación
          </Text>
        </View>
      </View>

      {/* Card + botón flotantes de abajo, sin fondo detrás ni línea divisoria entre
          ellos — cada uno con su propia drop shadow liviana en vez de un contenedor
          compartido, para que el mapa se vea directo alrededor de los dos.
          `paddingBottom: insets.bottom` porque, a diferencia del resto de las
          pantallas, acá no hay `SafeAreaView` (el mapa ocupa el área completa,
          insets incluidos) — sin esto el botón quedaba pegado al home indicator. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom,
        }}
      >
        <View className="gap-3 px-5 pb-4">
          <ErrorBanner testID={testID ? `${testID}-error` : undefined} message={error} />
          <View
            className="rounded-[12px] bg-bg px-4 py-3"
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: isDark ? 0.3 : 0.08,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            <Text numberOfLines={2} className="font-sans-medium text-[15px] text-fg">
              {selection.address}
            </Text>
          </View>
          <Pressable
            testID={testID ? `${testID}-save` : undefined}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void handleSave();
            }}
            disabled={createAddress.isPending}
            className={`w-full flex-row items-center justify-center gap-2 rounded-lg py-3.5 ${
              createAddress.isPending ? "bg-bg-mute" : "bg-fg"
            }`}
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: isDark ? 0.35 : 0.1,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            {createAddress.isPending ? <ActivityIndicator color={colors.fg3} /> : null}
            <Text
              className={`font-sans-semibold text-body ${
                createAddress.isPending ? "text-fg-3" : "text-bg"
              }`}
            >
              Guardar dirección
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
