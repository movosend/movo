import { Search, X } from "lucide-react-native";
import { Pressable, TextInput, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface RatingsSearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  testID?: string;
}

/** Buscador por nombre de quien calificó, arriba de "Tus calificaciones" (MOVO-354). Filtra en el cliente. */
export function RatingsSearchField({ value, onChangeText, testID }: RatingsSearchFieldProps) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-2.5 rounded-[12px] border border-border bg-bg-mute px-3.5 py-2.5">
      <Search size={16} color={colors.fg3} strokeWidth={2} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder="Buscá por nombre"
        placeholderTextColor={colors.fg3}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        textAlignVertical="center"
        className="flex-1 font-sans text-[15px] text-fg"
        style={{ includeFontPadding: false }}
      />
      {value.length > 0 ? (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityLabel="Borrar búsqueda"
          onPress={() => onChangeText("")}
          hitSlop={8}
        >
          <X size={18} color={colors.fg3} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}
