import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { CircleCheck, MessageCircle, Search, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useDebouncedValue } from "../../src/hooks/use-debounced-value";
import type { OnFocusInput } from "../../src/hooks/use-keyboard-scroll";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { usersClient } from "../../src/api/users-client";
import { capitalizeName } from "../../src/lib/profile-format";
import { AvatarImage } from "../ui/avatar-image";
import { SkeletonBlock } from "../ui/skeleton-block";
import { ReceiverResultRow } from "./receiver-result-row";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;
const SKELETON_ROWS = 3;

/** Fila fantasma mientras resuelve la primera búsqueda (MOVO-83, feedback de UI):
 * mismo alto/gap que `ReceiverResultRow`, sin esperar a que lleguen resultados reales
 * para mostrar algo con la forma final en vez de la lista vacía + spinner del input. */
function ReceiverResultSkeletonRow() {
  return (
    <View className="flex-row items-center gap-2.5 px-3.5 py-3">
      <SkeletonBlock className="h-9 w-9 rounded-full" />
      <View className="flex-1 gap-1.5">
        <SkeletonBlock className="h-3 w-32 rounded-sm" />
        <SkeletonBlock className="h-2.5 w-24 rounded-sm" />
      </View>
    </View>
  );
}

// TODO: sumar el link de descarga real (App Store/Play Store) al mensaje cuando la
// app esté publicada — todavía no existe (proyecto sin lanzar, ver "Pendientes
// transversales" en CLAUDE.md).
function buildInviteMessage(query: string): string {
  return (
    `¡Hola${query ? `, ${query}` : ""}! Te quiero enviar un paquete por Movo, pero todavía no ` +
    "estás registrado/a. Movo es una app para mandar paquetes con gente que ya viaja tu misma ruta. " +
    "¿Te sumás?"
  );
}

function whatsappInviteUrl(query: string): string {
  return `https://wa.me/?text=${encodeURIComponent(buildInviteMessage(query))}`;
}

interface ReceiverSearchFieldProps {
  selected: PublicProfile | null;
  onSelect: (profile: PublicProfile) => void;
  onClear: () => void;
  onFocusInput: OnFocusInput;
  testID?: string;
}

/** Campo de búsqueda + confirmación explícita de receptor (AC4). Tocar un resultado
 * válido llena el campo como "pill" (avatar + nombre + check) sin avanzar el paso
 * solo — el botón "Siguiente" del paso es lo que confirma de verdad. */
export function ReceiverSearchField({
  selected,
  onSelect,
  onClear,
  onFocusInput,
  testID,
}: ReceiverSearchFieldProps) {
  const colors = useThemeColors();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  // Query al que corresponden los `results` actuales — `null` mientras ninguna
  // búsqueda terminó todavía. Comparar esto contra `trimmedQuery` (en vez de un
  // booleano `loading` separado) es lo que evita la carrera: `loading` recién pasa a
  // `true` DENTRO del efecto, un render después de que `debouncedQuery` cambia, así
  // que hay un frame en el medio con `loading=false` y `results` todavía del query
  // anterior — ahí se colaba "no encontramos a nadie" un instante antes de que
  // aparezca la persona real. `resultsQuery` se actualiza en el mismo `setState` que
  // `results`, nunca queda desincronizado de lo que representa.
  const [resultsQuery, setResultsQuery] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();

  useEffect(() => {
    if (selected || trimmedQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setResultsQuery(null);
      return;
    }
    let cancelled = false;
    usersClient
      .search(trimmedQuery)
      .then((found) => {
        if (!cancelled) {
          setResults(found);
          setResultsQuery(trimmedQuery);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setResultsQuery(trimmedQuery);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [trimmedQuery, selected]);

  const searching = !selected && trimmedQuery.length >= MIN_QUERY_LENGTH && resultsQuery !== trimmedQuery;
  const showDropdown = !selected && !searching && results.length > 0;
  // Solo para la primera búsqueda (sin resultados todavía) — un refetch por tecleo
  // sobre resultados ya visibles no reemplaza la lista por el skeleton, el spinner
  // del input ya cubre ese caso sin el parpadeo de vaciar y repoblar la lista.
  const showSkeleton = !selected && searching && results.length === 0;
  const showInvite = !selected && !searching && trimmedQuery.length >= MIN_QUERY_LENGTH && results.length === 0;

  const handleInvite = () => {
    Linking.openURL(whatsappInviteUrl(trimmedQuery)).catch(() => {
      // Sin WhatsApp instalado no hay fallback razonable acá — invitar es una
      // acción secundaria, no bloquea el resto del paso.
    });
  };

  return (
    <View>
      <View
        className={`min-h-[48px] flex-row items-center gap-2.5 rounded-lg border px-3.5 py-2.5 ${
          selected ? "border-fg bg-bg-mute" : "border-border-strong bg-bg"
        }`}
      >
        {selected ? (
          <View className="flex-1 flex-row items-center gap-2.5">
            <AvatarImage fullName={selected.fullName} photoUrl={selected.photoUrl} size={32} />
            <View className="flex-1">
              <Text
                className="font-sans-semibold text-[14px] text-fg"
                numberOfLines={1}
              >
                {capitalizeName(selected.fullName)}
              </Text>
              <View className="flex-row items-center gap-1">
                <CircleCheck size={11} color="#2BB673" strokeWidth={2.5} />
                <Text className="font-sans text-[11px] text-fg-3">
                  Identidad verificada
                </Text>
              </View>
            </View>
            <Pressable
              testID={testID ? `${testID}-clear` : undefined}
              onPress={onClear}
              hitSlop={8}
            >
              <X size={18} color={colors.fg3} strokeWidth={2} />
            </Pressable>
          </View>
        ) : (
          <>
            <Search size={16} color={colors.fg3} strokeWidth={2} />
            <TextInput
              ref={inputRef}
              testID={testID}
              value={query}
              onChangeText={setQuery}
              onFocus={() => onFocusInput(inputRef)}
              placeholder="Buscá por nombre y apellido"
              placeholderTextColor={colors.fg3}
              textAlignVertical="center"
              // `text-[15px]` sin lineHeight propio (no `text-body`) — ver el comentario de
              // `text-field.tsx` sobre por qué un `TextInput` de una sola línea con
              // lineHeight explícito queda descentrado hacia abajo en iOS.
              className="flex-1 font-sans text-[15px] text-fg"
              style={{ includeFontPadding: false }}
            />
            {searching ? (
              <ActivityIndicator size="small" color={colors.fg3} />
            ) : null}
          </>
        )}
      </View>

      {showSkeleton ? (
        <View
          testID={testID ? `${testID}-skeleton` : undefined}
          className="mt-1.5 overflow-hidden rounded-[10px] border border-border bg-bg"
        >
          {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <View key={index} className={index === 0 ? "" : "border-t border-border"}>
              <ReceiverResultSkeletonRow />
            </View>
          ))}
        </View>
      ) : null}

      {showDropdown ? (
        <View
          testID={testID ? `${testID}-results` : undefined}
          className="mt-1.5 overflow-hidden rounded-[10px] border border-border bg-bg"
        >
          {results.map((profile, index) => (
            <View
              key={profile.id}
              className={index === 0 ? "" : "border-t border-border"}
            >
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

      {showInvite ? (
        <View
          testID={testID ? `${testID}-invite` : undefined}
          className="mt-1.5 gap-2.5 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3"
        >
          <Text className="font-sans text-[13px] text-fg-2">
            No encontramos a nadie con ese nombre en Movo. ¿Querés invitarlo/a a
            sumarse?
          </Text>
          <Pressable
            testID={testID ? `${testID}-invite-whatsapp` : undefined}
            onPress={handleInvite}
            className="w-full flex-row items-center justify-center gap-2 rounded-full bg-fg px-4 py-2"
          >
            <MessageCircle size={14} color={colors.bg} strokeWidth={2} />
            <Text className="font-sans-semibold text-[13px] text-bg">
              Invitar por WhatsApp
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
