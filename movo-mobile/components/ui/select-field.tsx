import { ChevronDown, Check } from "lucide-react-native";
import { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  testID?: string;
  containerClassName?: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = "Seleccioná una opción",
  error,
  testID,
  containerClassName,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const colors = useThemeColors();
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(open);

  return (
    <View className={containerClassName ?? "mb-3.5 gap-1.5"}>
      <Text className="font-sans-medium text-[12px] text-fg-2">{label}</Text>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        className="w-full flex-row items-center justify-between rounded-md border border-border-strong px-3.5 py-3"
      >
        <Text
          className={`font-sans text-body ${value ? "text-fg" : "text-fg-2"}`}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={18} color={colors.fg3} strokeWidth={2} />
      </Pressable>
      {error ? (
        <Text
          testID={testID ? `${testID}-error` : undefined}
          className="font-sans text-[12px] text-danger-500"
        >
          {error}
        </Text>
      ) : null}

      <Modal
        visible={isMounted}
        animationType="none"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1">
          {/* Overlay: solo hace fade (nunca se desliza) — ver `useSheetAnimation`. */}
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              className="flex-1 bg-black/40"
              onPress={() => setOpen(false)}
            />
          </Animated.View>
          <View className="flex-1 justify-end" pointerEvents="box-none">
            <Animated.View style={sheetStyle}>
              <View className="max-h-[70%] rounded-t-2xl bg-bg">
                <SafeAreaView edges={["bottom"]}>
                  <View className="items-center border-b border-border-strong px-5 py-3.5">
                    <Text className="font-sans-medium text-[14px] text-fg">
                      {label}
                    </Text>
                  </View>
                  <FlatList
                    data={options}
                    keyExtractor={(item) => item}
                    renderItem={({ item }) => (
                      <Pressable
                        testID={testID ? `${testID}-option-${item}` : undefined}
                        onPress={() => {
                          onChange(item);
                          setOpen(false);
                        }}
                        className="flex-row items-center justify-between px-5 py-3.5"
                      >
                        <Text className="font-sans text-body text-fg">
                          {item}
                        </Text>
                        {item === value ? (
                          <Check size={18} color={colors.fg1} strokeWidth={2} />
                        ) : null}
                      </Pressable>
                    )}
                  />
                </SafeAreaView>
              </View>
            </Animated.View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
