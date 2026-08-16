import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { CircleCheck, Search, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { useDebouncedValue } from "../../src/hooks/use-debounced-value";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { usersClient } from "../../src/api/users-client";
import { ReceiverResultRow } from "./receiver-result-row";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;

function initials(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

interface ReceiverSearchFieldProps {
  selected: PublicProfile | null;
  onSelect: (profile: PublicProfile) => void;
  onClear: () => void;
  testID?: string;
}

/** Campo de búsqueda + confirmación explícita de receptor (AC4). Tocar un resultado
 * válido llena el campo como "pill" (avatar + nombre + check) sin avanzar el paso
 * solo — el botón "Siguiente" del paso es lo que confirma de verdad. */
export function ReceiverSearchField({ selected, onSelect, onClear, testID }: ReceiverSearchFieldProps) {
  const colors = useThemeColors();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  useEffect(() => {
    if (selected || debouncedQuery.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    usersClient
      .search(debouncedQuery.trim())
      .then((found) => {
        if (!cancelled) setResults(found);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selected]);

  const showDropdown = !selected && results.length > 0;

  return (
    <View>
      <View
        className={`min-h-[48px] flex-row items-center gap-2.5 rounded-lg border px-3.5 py-2.5 ${
          selected ? "border-fg bg-bg-mute" : "border-border-strong bg-bg"
        }`}
      >
        {selected ? (
          <View className="flex-1 flex-row items-center gap-2.5">
            <View className="h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-bg-mute">
              {selected.photoUrl ? (
                <Image source={{ uri: selected.photoUrl }} className="h-full w-full" resizeMode="cover" />
              ) : (
                <Text className="font-sans-semibold text-[11px] text-fg-2">{initials(selected.fullName)}</Text>
              )}
            </View>
            <View className="flex-1">
              <Text className="font-sans-semibold text-[14px] text-fg" numberOfLines={1}>
                {selected.fullName}
              </Text>
              <View className="flex-row items-center gap-1">
                <CircleCheck size={11} color="#2BB673" strokeWidth={2.5} />
                <Text className="font-sans text-[11px] text-fg-3">Identidad verificada</Text>
              </View>
            </View>
            <Pressable testID={testID ? `${testID}-clear` : undefined} onPress={onClear} hitSlop={8}>
              <X size={18} color={colors.fg3} strokeWidth={2} />
            </Pressable>
          </View>
        ) : (
          <>
            <Search size={16} color={colors.fg3} strokeWidth={2} />
            <TextInput
              testID={testID}
              value={query}
              onChangeText={setQuery}
              placeholder="Buscá por nombre y apellido"
              placeholderTextColor={colors.fg3}
              className="flex-1 font-sans text-[15px] text-fg"
            />
            {loading ? <ActivityIndicator size="small" color={colors.fg3} /> : null}
          </>
        )}
      </View>

      {showDropdown ? (
        <View
          testID={testID ? `${testID}-results` : undefined}
          className="mt-1.5 overflow-hidden rounded-[10px] border border-border bg-bg"
        >
          {results.map((profile, index) => (
            <View key={profile.id} className={index === 0 ? "" : "border-t border-border"}>
              <ReceiverResultRow
                testID={testID ? `${testID}-result-${profile.id}` : undefined}
                profile={profile}
                onSelect={(p) => {
                  onSelect(p);
                  setQuery("");
                }}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
