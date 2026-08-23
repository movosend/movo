import { Star } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { Address } from "../../src/api/addresses-client";
import { useUpdateAddress } from "../../src/hooks/use-addresses";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { PrimaryButton } from "../auth/primary-button";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

// Mismo fallback que `address-search-sheet.tsx`: `initialWindowMetrics` es `null` en
// Jest (sin native module real).
const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const SAVE_ERROR = "No pudimos guardar los cambios. Probá de nuevo.";

interface EditAddressSheetProps {
  visible: boolean;
  address: Address | null;
  onClose: () => void;
  testID?: string;
}

/**
 * Edición de una dirección guardada (MOVO-121, AC4) — alcance acordado: solo
 * `label`/`isDefault`, sin reabrir el buscador de Places para cambiar la dirección
 * física. `isDefault` nunca se manda en `false` (el backend lo rechaza con 400, ver
 * `UpdateAddressInput` en `@movo/shared`) — el toggle queda deshabilitado si la
 * dirección ya es la default, y solo viaja `isDefault: true` cuando se activa.
 */
export function EditAddressSheet({
  visible,
  address,
  onClose,
  testID,
}: EditAddressSheetProps) {
  const colors = useThemeColors();
  const updateAddress = useUpdateAddress();
  const [label, setLabel] = useState("");
  const [markAsDefault, setMarkAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  useEffect(() => {
    if (visible && address) {
      setLabel(address.label ?? "");
      setMarkAsDefault(address.isDefault);
      setError(null);
    }
  }, [visible, address]);

  const handleSave = async () => {
    if (!address) return;
    setError(null);
    try {
      await updateAddress.mutateAsync({
        id: address.id,
        body: {
          label: label.trim() || null,
          ...(markAsDefault && !address.isDefault ? { isDefault: true } : {}),
        },
      });
      onClose();
    } catch {
      setError(SAVE_ERROR);
    }
  };

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={onClose}
      testID={testID}
    >
      <SafeAreaProvider
        initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View className="flex-1">
            {/* Overlay: solo hace fade (nunca se desliza) — ver `useSheetAnimation`. */}
            <Animated.View
              style={[StyleSheet.absoluteFill, backdropStyle]}
            >
              <Pressable
                testID={testID ? `${testID}-backdrop` : undefined}
                onPress={onClose}
                className="flex-1 bg-black/40"
              />
            </Animated.View>
            <View className="flex-1 justify-end" pointerEvents="box-none">
              <Animated.View style={sheetStyle}>
                <SafeAreaView
                  className="rounded-t-2xl bg-bg"
                  edges={["bottom"]}
                >
                  <View className="px-5 pt-5">
                    <Text className="mb-4 font-sans-semibold text-h3 text-fg">
                      Editar dirección
                    </Text>
                    <ErrorBanner
                      testID={testID ? `${testID}-error` : undefined}
                      message={error}
                    />
                    <TextField
                      testID={testID ? `${testID}-label` : undefined}
                      label="Nombre (opcional)"
                      placeholder="Ej: Casa, Trabajo"
                      value={label}
                      onChangeText={setLabel}
                    />
                    <Pressable
                      testID={testID ? `${testID}-toggle-default` : undefined}
                      onPress={() => setMarkAsDefault((v) => !v)}
                      disabled={address?.isDefault}
                      className="mb-2 flex-row items-center gap-2.5 rounded-[10px] border border-border-strong px-3.5 py-3"
                    >
                      <Star
                        size={16}
                        color={markAsDefault ? "#C6F24A" : colors.fg3}
                        fill={markAsDefault ? "#C6F24A" : "none"}
                      />
                      <Text className="flex-1 font-sans-medium text-[14px] text-fg">
                        {address?.isDefault
                          ? "Ya es tu dirección default"
                          : "Marcar como default"}
                      </Text>
                    </Pressable>
                  </View>
                  <PrimaryButton
                    testID={testID ? `${testID}-save` : undefined}
                    label="Guardar"
                    onPress={() => void handleSave()}
                    loading={updateAddress.isPending}
                  />
                </SafeAreaView>
              </Animated.View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}
