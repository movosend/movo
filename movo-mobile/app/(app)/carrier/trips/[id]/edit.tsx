import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, WifiOff } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TripForm } from "../../../../../components/trips/trip-form";
import { useTrip, useUpdateTrip } from "../../../../../src/hooks/use-trips";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../../src/lib/error-messages";
import { TripStatus, type CreateTripInput } from "../../../../../src/api/trips-client";

const UPDATE_ERROR_FALLBACK = "No pudimos guardar los cambios. Probá de nuevo.";

/** Editar viaje (MOVO-162, AC3) — sibling de `new.tsx`, mismo `TripForm`. */
export default function EditTripScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: trip, isLoading, isError, refetch } = useTrip(id);
  const updateTrip = useUpdateTrip();
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
    if (!id) return;
    setError(null);
    updateTrip.mutate(
      { id, body: input },
      {
        onSuccess: () => handleBack(),
        onError: (err) => setError(friendlyErrorMessage(err, UPDATE_ERROR_FALLBACK)),
      },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="edit-trip-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Editar viaje</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.fg3} />
        </View>
      ) : isError || !trip ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">
            No pudimos cargar este viaje.
          </Text>
          <Text
            testID="edit-trip-retry"
            onPress={() => refetch()}
            className="font-sans-medium text-small text-fg"
          >
            Reintentar
          </Text>
        </View>
      ) : trip.hasAcceptedPackages ? (
        // Carrera real: el viaje se aceptó paquetes después de que el usuario tocó
        // "Editar" desde una lista ya desactualizada. Mismo mensaje que la card
        // bloqueada del listado (MOVO-162 AC4) — no tiene sentido mostrar un
        // formulario que el backend va a rechazar con 409 igual.
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Text
            testID="edit-trip-blocked"
            className="text-center font-sans-medium text-body text-fg"
          >
            Este viaje tiene paquetes aceptados
          </Text>
          <Text className="text-center font-sans text-small text-fg-2">
            No se puede modificar ni cancelar directamente.
          </Text>
        </View>
      ) : trip.status !== TripStatus.ACTIVE ? (
        // Hallazgo de review (PR #120): un viaje `cancelled`/`completed` no debería
        // mostrar el formulario editable — mismo criterio que el bloqueo de arriba,
        // solo que acá la razón es el estado del viaje, no paquetes aceptados.
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Text
            testID="edit-trip-not-active"
            className="text-center font-sans-medium text-body text-fg"
          >
            Este viaje ya no está activo
          </Text>
          <Text className="text-center font-sans text-small text-fg-2">
            No se puede modificar un viaje que ya no está activo.
          </Text>
        </View>
      ) : (
        <TripForm
          testID="edit-trip-form"
          submitLabel="Guardar cambios"
          submitting={updateTrip.isPending}
          error={error}
          initialValues={{
            origin: { address: trip.originAddress, lat: trip.originLat, lng: trip.originLng, source: "map-pin" },
            destination: {
              address: trip.destinationAddress,
              lat: trip.destinationLat,
              lng: trip.destinationLng,
              source: "map-pin",
            },
            departureAt: new Date(trip.departureAt),
            vehicleType: trip.vehicleType,
          }}
          onSubmit={handleSubmit}
        />
      )}
    </SafeAreaView>
  );
}
