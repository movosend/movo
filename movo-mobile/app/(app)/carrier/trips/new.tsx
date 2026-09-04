import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TripForm } from "../../../../components/trips/trip-form";
import { useCreateTrip } from "../../../../src/hooks/use-trips";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import type { CreateTripInput } from "../../../../src/api/trips-client";

const CREATE_ERROR_FALLBACK = "No pudimos declarar el viaje. Probá de nuevo.";

/** Declarar viaje (MOVO-162, AC1) — sibling de `[id]/edit.tsx`, mismo `TripForm`. */
export default function NewTripScreen() {
  const colors = useThemeColors();
  const createTrip = useCreateTrip();
  const [error, setError] = useState<string | null>(null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
      router.replace("/carrier/trips" as any);
    }
  };

  const handleSubmit = (input: CreateTripInput) => {
    setError(null);
    createTrip.mutate(input, {
      // Reemplaza (no `back()`) para garantizar que el flag de éxito llegue a "Mis
      // viajes" — mismo patrón que `forgot-password.tsx` → `login.tsx` (AC de
      // confirmación visual). De paso evita dejar el formulario ya enviado en el
      // stack para un swipe-back accidental.
      // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
      onSuccess: () =>
        router.replace({ pathname: "/carrier/trips", params: { created: "1" } } as any),
      onError: (err) => setError(friendlyErrorMessage(err, CREATE_ERROR_FALLBACK)),
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="new-trip-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Declarar viaje</Text>
      </View>

      <TripForm
        testID="new-trip-form"
        submitLabel="Declarar viaje"
        submitting={createTrip.isPending}
        error={error}
        onSubmit={handleSubmit}
      />
    </SafeAreaView>
  );
}
