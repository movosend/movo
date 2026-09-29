import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { TripStatus, type TripWithAcceptedPackages } from "../../src/api/trips-client";
import { shortAddressLabel } from "../../src/lib/shipment-format";
import {
  formatDepartureDateOnly,
  formatDepartureLabel,
  isTripDepartureToday,
  tripStatusLabel,
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

  return (
    <View
      testID={testID}
      className="overflow-hidden rounded-[10px] border border-border bg-bg-mute p-3.5"
    >
      <View className="flex-row items-center gap-1.5 flex-wrap">
        {isToday ? (
          <View className="rounded-full bg-fg px-2.5 py-0.5">
            <Text className="font-sans-semibold text-[10px] uppercase tracking-wider text-bg">
              Hoy
            </Text>
          </View>
        ) : (
          <View className="rounded-full border border-border bg-bg px-2.5 py-0.5">
            <Text className="font-sans-medium text-[10px] text-fg-2">
              {formatDepartureDateOnly(trip.departureAt)}
            </Text>
          </View>
        )}

        <View
          className={`rounded-full px-2.5 py-0.5 ${
            isActive ? "bg-lime-200" : "border border-border bg-bg"
          }`}
        >
          <Text
            className={`font-sans-semibold text-[10px] uppercase tracking-wider ${
              isActive ? "text-ink-950" : "text-fg-2"
            }`}
          >
            {isActive ? "En curso" : tripStatusLabel(trip.status)}
          </Text>
        </View>

        {trip.hasAcceptedPackages ? (
          <View className="rounded-full bg-lime-500/15 px-2 py-0.5">
            <Text className="font-sans-medium text-[10px] text-fg-2">
              Paquetes aceptados
            </Text>
          </View>
        ) : null}
      </View>

      <View className="mt-2.5 gap-0.5">
        <Text className="font-sans-semibold text-[16px] text-fg">
          Viaje del {formatDepartureDateOnly(trip.departureAt)}
        </Text>
        <Text className="font-sans text-[13px] text-fg-3" numberOfLines={1}>
          {shortAddressLabel(trip.originAddress)} → {shortAddressLabel(trip.destinationAddress)}
        </Text>
        <Text className="font-sans text-[11.5px] text-fg-3">
          Salida: {formatDepartureLabel(trip.departureAt)}
        </Text>
      </View>

      {errorMessage ? (
        <View className="mt-2.5">
          <ErrorBanner
            testID={testID ? `${testID}-error` : undefined}
            message={errorMessage}
          />
        </View>
      ) : null}

      <View className="mt-3">
        {isDeclared ? (
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
