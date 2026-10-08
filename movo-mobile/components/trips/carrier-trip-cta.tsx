import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { TripStatus, type TripWithAcceptedPackages } from "../../src/api/trips-client";
import {
  formatDepartureDateOnly,
  formatPackagesCount,
  isTripDepartureToday,
  tripRouteLabel,
  tripStartBlocker,
  tripStartBlockerMessage,
} from "../../src/lib/trip-format";
import { ErrorBanner } from "../ui/error-banner";

interface CarrierTripCtaProps {
  trip: TripWithAcceptedPackages;
  onStart?: (trip: TripWithAcceptedPackages) => void | Promise<void>;
  isStarting?: boolean;
  errorMessage?: string | null;
  testID?: string;
}

/**
 * Card / CTA de viaje del transportista (MOVO-252).
 * Implementa la card operativa del prototipo de Tomás ("Viaje del transportista.dc.html").
 *
 * AC1: Cuando el viaje está `declared` con paquetes aceptados (`hasAcceptedPackages: true`),
 * muestra el CTA visible "Iniciar viaje" (h-[52px], bg-lime-500, font-sans-semibold, text-ink-950).
 * AC2/AC3: Al pasar a `active`, el botón se convierte en "Viaje en curso · ver mapa" (bg-fg, text-bg),
 * que navega a la vista de mapa `/route?tripId=...`.
 * AC4/AC5/AC6: Muestra banner de error ante fallos de inicio (límite de 1 viaje activo, fecha futura, red).
 * AC8: Si no está en `declared` con paquetes aceptados ni en `active`, no se renderiza.
 *
 * Título = ruta ("Córdoba → Rosario"), no la fecha: la fecha ya va en el chip/subtítulo y
 * repetirla en el título era redundante. El resumen usa `acceptedPackagesCount` (misma
 * fuente que decide si el viaje se muestra) en vez de paradas derivadas de
 * `/shipments/transporting`, que solo cubre `assigned*`/`in_transit` y daba "0 paradas"
 * con paquetes aceptados todavía en `assignment_pending`. Sin distancia: era línea recta
 * (Haversine), no la del recorrido.
 *
 * MOVO-277: "Iniciar viaje" solo aparece si `tripStartBlocker` lo permite (misma regla que
 * el backend). Si no, en su lugar va el motivo: "Podés iniciarlo el {fecha}" o que los
 * paquetes esperan el pago. Si no todos los paquetes son ejecutables, el resumen lo dice
 * ("3 paquetes · 1 listo"), así no promete paradas que la ruta no va a mostrar.
 */
export function CarrierTripCta({
  trip,
  onStart,
  isStarting = false,
  errorMessage,
  testID,
}: CarrierTripCtaProps) {
  // AC8: Si es declared sin paquetes aceptados (o cancelado/completado), no renderiza CTA
  if (
    trip.status !== TripStatus.ACTIVE &&
    (trip.status !== TripStatus.DECLARED || !trip.hasAcceptedPackages)
  ) {
    return null;
  }

  const isToday = isTripDepartureToday(trip.departureAt);
  const isDeclared = trip.status === TripStatus.DECLARED;
  const isActive = trip.status === TripStatus.ACTIVE;
  const startBlocker = isDeclared ? tripStartBlocker(trip) : null;
  const notReadyCount = trip.acceptedPackagesCount - trip.executablePackagesCount;
  const packagesSummary =
    notReadyCount > 0
      ? `${formatPackagesCount(trip.acceptedPackagesCount)} · ${trip.executablePackagesCount} ${
          trip.executablePackagesCount === 1 ? "listo" : "listos"
        }`
      : formatPackagesCount(trip.acceptedPackagesCount);

  return (
    <View
      testID={testID}
      className="overflow-hidden rounded-[10px] border border-border bg-white dark:bg-bg-sub"
    >
      <View className="gap-2.5 p-3.5 pb-0">
        <View className="flex-row items-center gap-1.5">
          {isActive ? (
            <View className="h-[22px] flex-row items-center justify-center gap-1.5 rounded-full bg-lime-200 px-[9px]">
              <View className="h-1.5 w-1.5 rounded-full bg-ink-950" />
              <Text className="font-sans-semibold text-[10px] uppercase tracking-wider text-ink-950">
                En curso
              </Text>
            </View>
          ) : isToday ? (
            <View className="h-[22px] items-center justify-center rounded-full bg-fg px-[9px]">
              <Text className="font-sans-semibold text-[10px] uppercase tracking-wider text-bg">
                Hoy
              </Text>
            </View>
          ) : (
            <Text className="font-sans-medium text-caption uppercase text-fg-3">
              {formatDepartureDateOnly(trip.departureAt)}
            </Text>
          )}
        </View>

        <View className="gap-[3px]">
          <Text numberOfLines={1} className="font-sans-semibold text-[19px] tracking-tight text-fg">
            {tripRouteLabel(trip)}
          </Text>
          <Text testID={testID ? `${testID}-packages` : undefined} className="font-sans text-[13px] text-fg-3">
            {packagesSummary}
          </Text>
        </View>
      </View>

      {errorMessage ? (
        <View className="px-3.5 pt-2.5">
          <ErrorBanner
            testID={testID ? `${testID}-error` : undefined}
            message={errorMessage}
          />
        </View>
      ) : null}

      <View className="p-3.5">
        {startBlocker ? (
          <View
            testID={testID ? `${testID}-start-blocked` : undefined}
            className="min-h-[52px] w-full items-center justify-center rounded-[8px] bg-bg-mute px-4 py-3"
          >
            <Text className="text-center font-sans-medium text-[14px] text-fg-2">
              {tripStartBlockerMessage(trip, startBlocker)}
            </Text>
          </View>
        ) : isDeclared ? (
          <Pressable
            testID={testID ? `${testID}-start-button` : undefined}
            onPress={() => onStart?.(trip)}
            disabled={isStarting}
            accessibilityRole="button"
            accessibilityLabel="Iniciar viaje"
            className="h-[52px] w-full items-center justify-center rounded-[8px] bg-lime-500 active:opacity-90"
          >
            {isStarting ? (
              <ActivityIndicator size="small" color="#0A0A0B" />
            ) : (
              <Text className="font-sans-semibold text-[15px] text-ink-950">
                Iniciar viaje
              </Text>
            )}
          </Pressable>
        ) : isActive ? (
          <Pressable
            testID={testID ? `${testID}-view-map-button` : undefined}
            onPress={() =>
              router.push({
                pathname: "/route",
                params: { tripId: trip.id },
              } as any)
            }
            accessibilityRole="button"
            accessibilityLabel="Viaje en curso, ver mapa"
            className="h-[52px] w-full items-center justify-center rounded-[8px] bg-fg active:opacity-90"
          >
            <Text className="font-sans-semibold text-[15px] text-bg">
              Viaje en curso · ver mapa
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
