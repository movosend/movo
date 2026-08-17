import {
  ChevronLeft,
  MapPin,
  Navigation,
  Search,
  Star,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import {
  placesClient,
  type PlacePrediction,
} from "../../src/api/places-client";
import type { Address } from "../../src/api/addresses-client";
import { useDebouncedValue } from "../../src/hooks/use-debounced-value";
import { useShipmentAddress } from "../../src/hooks/use-shipment-address";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { AddressSelection } from "../../src/store/shipment-wizard-store";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;

// `initialWindowMetrics` viene de las constantes nativas leídas al cargar el bundle,
// sin depender de que exista un `<SafeAreaProvider>` en el árbol — pero es `null` en
// Jest (sin native module real). Fallback solo para no bloquear el primer render ahí;
// en device siempre viene poblado.
const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

interface AddressSearchSheetProps {
  visible: boolean;
  label: string;
  savedAddresses: Address[] | undefined;
  onClose: () => void;
  onSelect: (selection: AddressSelection) => void;
  testID?: string;
}

/**
 * Búsqueda de dirección estilo Uber/PedidosYa (MOVO-83, rediseño post-feedback):
 * pantalla completa con un solo campo de texto libre + lista de direcciones
 * completas sugeridas por Google Places (proxeado server-side, mismo criterio que
 * `/geocode`, ADR-014), en vez del formulario manual de 6 campos que reemplaza. GPS y
 * direcciones guardadas quedan siempre visibles arriba de la lista, incluso con la
 * búsqueda vacía.
 */
export function AddressSearchSheet({
  visible,
  label,
  savedAddresses,
  onClose,
  onSelect,
  testID,
}: AddressSearchSheetProps) {
  const colors = useThemeColors();
  const { useMyLocation, locating } = useShipmentAddress();
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setPredictions([]);
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (debouncedQuery.trim().length < MIN_QUERY_LENGTH) {
      setPredictions([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    placesClient
      .autocomplete(debouncedQuery.trim())
      .then((found) => {
        if (!cancelled) setPredictions(found);
      })
      .catch(() => {
        if (!cancelled) {
          setPredictions([]);
          setError(
            "No pudimos buscar direcciones ahora. Probá de nuevo en un momento.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    setResolving(true);
    setError(null);
    try {
      const details = await placesClient.details(prediction.placeId);
      onSelect({
        address: details.formattedAddress,
        lat: details.lat,
        lng: details.long,
        source: "places",
      });
    } catch {
      setError("No pudimos ubicar esa dirección. Probá con otra.");
    } finally {
      setResolving(false);
    }
  };

  const handleUseLocation = async () => {
    const selection = await useMyLocation();
    if (selection) onSelect(selection);
  };

  const handleSelectSaved = (saved: Address) => {
    onSelect({
      address:
        saved.label ?? `${saved.street} ${saved.streetNumber}, ${saved.city}`,
      lat: saved.lat,
      lng: saved.long,
      source: "saved",
    });
  };

  const showResults = debouncedQuery.trim().length >= MIN_QUERY_LENGTH;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <SafeAreaProvider
        initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}
      >
        <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View className="flex-row items-center gap-2 px-4 pb-2 pt-1">
              <Pressable
                testID={testID ? `${testID}-close` : undefined}
                onPress={onClose}
                hitSlop={8}
                className="h-11 w-11 items-center justify-center rounded-full"
              >
                <ChevronLeft size={22} color={colors.fg1} strokeWidth={2} />
              </Pressable>
              <Text className="font-sans-semibold text-h3 text-fg">{label}</Text>
            </View>

            <View className="flex-row items-center gap-2.5 rounded-lg border border-border-strong px-3.5 py-2.5 mx-4 mb-3">
              <Search size={16} color={colors.fg3} strokeWidth={2} />
              <TextInput
                testID={testID ? `${testID}-input` : undefined}
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Buscá una dirección…"
                placeholderTextColor={colors.fg3}
                textAlignVertical="center"
                // `text-[15px]` sin lineHeight propio — ver el comentario de `text-field.tsx`.
                className="flex-1 font-sans text-[15px] text-fg"
                style={{ includeFontPadding: false }}
              />
              {loading || resolving ? (
                <ActivityIndicator size="small" color={colors.fg3} />
              ) : null}
            </View>

            <ScrollView
              className="flex-1 px-4"
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
            >
              <Pressable onPress={Keyboard.dismiss}>
                <Pressable
                  testID={testID ? `${testID}-use-location` : undefined}
                  onPress={handleUseLocation}
                  disabled={locating}
                  className="flex-row items-center gap-3 border-b border-border py-3.5"
                >
                  {locating ? (
                    <ActivityIndicator size="small" color={colors.fg2} />
                  ) : (
                    <Navigation size={16} color={colors.fg2} strokeWidth={1.8} />
                  )}
                  <Text className="font-sans-medium text-[14px] text-fg">
                    Usar mi ubicación actual
                  </Text>
                </Pressable>

                {!showResults && savedAddresses && savedAddresses.length > 0 ? (
                  <View testID={testID ? `${testID}-saved` : undefined}>
                    <Text className="mb-1 mt-3 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
                      Direcciones guardadas
                    </Text>
                    {savedAddresses.map((saved) => (
                      <Pressable
                        key={saved.id}
                        testID={
                          testID ? `${testID}-saved-${saved.id}` : undefined
                        }
                        onPress={() => handleSelectSaved(saved)}
                        className="flex-row items-center gap-3 border-b border-border py-3.5"
                      >
                        {saved.isDefault ? (
                          <Star size={16} color="#C6F24A" fill="#C6F24A" />
                        ) : (
                          <MapPin
                            size={16}
                            color={colors.fg2}
                            strokeWidth={1.8}
                          />
                        )}
                        <View className="flex-1">
                          <Text
                            className="font-sans-medium text-[14px] text-fg"
                            numberOfLines={1}
                          >
                            {saved.label ?? saved.street}
                          </Text>
                          <Text
                            className="font-sans text-[12px] text-fg-3"
                            numberOfLines={1}
                          >
                            {saved.street} {saved.streetNumber}, {saved.city}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {showResults ? (
                  <View testID={testID ? `${testID}-results` : undefined}>
                    {predictions.map((prediction) => (
                      <Pressable
                        key={prediction.placeId}
                        testID={
                          testID
                            ? `${testID}-result-${prediction.placeId}`
                            : undefined
                        }
                        onPress={() => handleSelectPrediction(prediction)}
                        disabled={resolving}
                        className="flex-row items-center gap-3 border-b border-border py-3.5"
                      >
                        <MapPin size={16} color={colors.fg2} strokeWidth={1.8} />
                        <Text
                          className="flex-1 font-sans text-[14px] text-fg"
                          numberOfLines={2}
                        >
                          {prediction.description}
                        </Text>
                      </Pressable>
                    ))}
                    {!loading && predictions.length === 0 && !error ? (
                      <Text className="mt-4 text-center font-sans text-[13px] text-fg-3">
                        No encontramos esa dirección.
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {error ? (
                  <Text className="mt-3 font-sans text-[12px] text-danger-500">
                    {error}
                  </Text>
                ) : null}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
