import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CarrierRequirementsSheet } from "../../../../components/carrier/carrier-requirements-checklist";
import { TripForm } from "../../../../components/trips/trip-form";
import { useCarrierRequirementsSheet } from "../../../../src/hooks/use-carrier-requirements-sheet";
import { useCreateTrip } from "../../../../src/hooks/use-trips";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { requireCarrierLocation } from "../../../../src/store/carrier-location-gate-store";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import type { CreateTripInput } from "../../../../src/api/trips-client";
import { SuspendedScreenGate } from "../../../../components/account/suspended-screen-gate";

const CREATE_ERROR_FALLBACK = "No pudimos declarar el viaje. Probá de nuevo.";

/** Declarar viaje (MOVO-162, AC1) — sibling de `[id]/edit.tsx`, mismo `TripForm`. */
function NewTripScreenContent() {
  const colors = useThemeColors();
  const createTrip = useCreateTrip();
  // MOVO-117: un 403 por licencia/MP faltante abre la checklist en vez de un error genérico.
  const requirements = useCarrierRequirementsSheet("trip");
  const [error, setError] = useState<string | null>(null);
  // MOVO-266: el tope de series se muestra inline en la card "Se repite", no arriba.
  const [recurrenceError, setRecurrenceError] = useState<string | null>(null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
      router.replace("/carrier/trips" as any);
    }
  };

  // Declarar un viaje es ofrecerse a transportar: se resuelve la ubicación en segundo
  // plano antes de crearlo, no recién al iniciarlo con paquetes ya aceptados.
  const handleSubmit = (input: CreateTripInput) =>
    requireCarrierLocation(() => createTripNow(input));

  const createTripNow = (input: CreateTripInput) => {
    setError(null);
    setRecurrenceError(null);
    createTrip.mutate(input, {
      // MOVO-340: `dismissTo` (no `replace`) vuelve a la instancia de "Mis viajes" que ya
      // está debajo del formulario, en vez de apilar una segunda — mismo patrón que MOVO-271.
      // Si no hay ninguna en el stack, reemplaza. `createdAt` cambia en cada alta para que
      // la instancia reusada vuelva a mostrar el banner de éxito.
      // `as any`: ruta nueva de MOVO-162, ver el comentario de `transport.tsx`.
      onSuccess: () =>
        router.dismissTo({
          pathname: "/carrier/trips",
          params: { created: "1", createdAt: String(Date.now()) },
        } as any),
      onError: (err) => {
        if (requirements.handleError(err)) return;
        if (err instanceof ApiError && err.code === "RECURRING_SERIES_LIMIT") {
          setRecurrenceError(friendlyErrorMessage(err, CREATE_ERROR_FALLBACK));
          return;
        }
        setError(friendlyErrorMessage(err, CREATE_ERROR_FALLBACK));
      },
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
        <Text className="font-sans-semibold text-h3 text-fg">
          Declarar viaje
        </Text>
      </View>
      <Text className="px-5 pb-4 mt-2 font-sans text-[13px] text-fg-3">
        Contanos cuándo y por dónde vas a viajar, de esta forma te avisamos
        apenas haya un paquete que te quede de paso en tu ruta, y podés ofertar
        por él.
      </Text>

      <TripForm
        testID="new-trip-form"
        submitLabel="Declarar viaje"
        recurringSubmitLabel="Declarar viaje recurrente"
        submitting={createTrip.isPending}
        error={error}
        recurrenceError={recurrenceError}
        onSubmit={handleSubmit}
      />
      <CarrierRequirementsSheet {...requirements.sheetProps} />
    </SafeAreaView>
  );
}

/** MOVO-300 AC2: con la cuenta suspendida no se declara un viaje (tampoco uno recurrente). */
export default function NewTripScreen() {
  return (
    <SuspendedScreenGate testID="new-trip-suspended" action="declareTrip">
      <NewTripScreenContent />
    </SuspendedScreenGate>
  );
}
