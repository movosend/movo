import { router } from "expo-router";
import { ChevronLeft, MapPinOff, WifiOff } from "lucide-react-native";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TripCard } from "../../../../components/trips/trip-card";
import { PrimaryButton } from "../../../../components/auth/primary-button";
import { SkeletonBlock } from "../../../../components/ui/skeleton-block";
import { useDeleteTrip, useMyTrips } from "../../../../src/hooks/use-trips";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import type { TripWithAcceptedPackages } from "../../../../src/api/trips-client";

function TripsListSkeleton() {
  return (
    <View className="gap-3 px-5 pt-2">
      {[0, 1, 2].map((i) => (
        <SkeletonBlock key={i} className="h-[150px] rounded-[14px]" />
      ))}
    </View>
  );
}

/**
 * "Mis viajes" (MOVO-162, AC2) — listado CRUD acotado de los viajes declarados por el
 * transportista, modelado sobre `app/(app)/addresses.tsx` (sin scroll infinito, a
 * diferencia de `shipments/index.tsx` — el volumen esperado no lo justifica, ver
 * CLAUDE.md). Sibling de `addresses.tsx`/`send.tsx` dentro de `app/(app)/`, hereda el
 * guard de sesión de `app/(app)/_layout.tsx`.
 */
export default function MyTripsScreen() {
  const colors = useThemeColors();
  const { data, isLoading, isError, refetch } = useMyTrips();
  const deleteTrip = useDeleteTrip();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)/transport");
    }
  };

  const handleDelete = (trip: TripWithAcceptedPackages) => {
    Alert.alert(
      "¿Cancelar este viaje?",
      "No vas a poder deshacer esta acción.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cancelar viaje",
          style: "destructive",
          onPress: () => deleteTrip.mutate(trip.id),
        },
      ],
    );
  };

  const trips = data?.items ?? [];
  const hasTrips = trips.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="my-trips-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Mis viajes</Text>
      </View>
      <Text className="px-5 pb-4 font-sans text-[13px] text-fg-3">
        Declará los viajes que tenés planeados para que otros usuarios encuentren
        paquetes compatibles con tu ruta.
      </Text>

      {isLoading ? (
        <TripsListSkeleton />
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">
            No pudimos cargar tus viajes.
          </Text>
          <Text
            testID="my-trips-retry"
            onPress={() => refetch()}
            className="font-sans-medium text-small text-fg"
          >
            Reintentar
          </Text>
        </View>
      ) : !hasTrips ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <MapPinOff size={26} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">
            Todavía no declaraste ningún viaje.
          </Text>
          <Pressable
            testID="my-trips-empty-add"
            // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
            onPress={() => router.push("/carrier/trips/new" as any)}
            className="rounded-full bg-bg-mute px-4 py-2.5"
          >
            <Text className="font-sans-medium text-[13px] text-fg">Declarar viaje</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView className="flex-1 px-5" contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              testID={`my-trips-card-${trip.id}`}
              trip={trip}
              // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
              onEdit={() => router.push(`/carrier/trips/${trip.id}/edit` as any)}
              onDelete={() => handleDelete(trip)}
            />
          ))}
        </ScrollView>
      )}

      {hasTrips ? (
        <PrimaryButton
          testID="my-trips-add"
          label="Declarar viaje"
          // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
          onPress={() => router.push("/carrier/trips/new" as any)}
        />
      ) : null}
    </SafeAreaView>
  );
}
