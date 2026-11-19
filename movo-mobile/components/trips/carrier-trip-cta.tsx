import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  ArrowRight,
  ChevronRight,
  Map,
  Navigation,
  Package,
} from "lucide-react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  TripStatus,
  type TripWithAcceptedPackages,
} from "../../src/api/trips-client";
import {
  formatDepartureDateOnly,
  formatPackagesCount,
  isTripDepartureToday,
  tripRouteLabel,
  tripStartBlocker,
  tripStartBlockerMessage,
} from "../../src/lib/trip-format";
import { formatTimeOfDay } from "../../src/lib/time-format";
import { ErrorBanner } from "../ui/error-banner";

interface CarrierTripCtaProps {
  trip: TripWithAcceptedPackages;
  onStart?: (trip: TripWithAcceptedPackages) => void | Promise<void>;
  isStarting?: boolean;
  errorMessage?: string | null;
  /** Pie de la tarjeta, debajo del botón (en Inicio, el aviso de ubicación compartida del viaje en curso). */
  footer?: React.ReactNode;
  /**
   * `hero`: la tarjeta es la acción principal de Inicio (el viaje de hoy o el que está en curso). Es la única
   * superficie oscura y el único botón lima de la pantalla. `default`: card neutra (mapa sin viaje en curso,
   * galería de dev).
   */
  variant?: "default" | "hero";
  testID?: string;
}

/**
 * Card / CTA de viaje del transportista (MOVO-252).
 * Implementa la card operativa del prototipo de Tomás ("Viaje del transportista.dc.html").
 *
 * AC1: Cuando el viaje está `declared` con paquetes aceptados (`hasAcceptedPackages: true`),
 * muestra el CTA visible "Iniciar viaje" (h-[52px], bg-lime-500, font-sans-semibold, text-ink-950).
 * AC2/AC3: Al pasar a `active`, el botón se convierte en "Ver mapa" (la pill "En curso" ya dice el estado) (bg-fg, text-bg),
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
  footer,
  variant = "default",
  testID,
}: CarrierTripCtaProps) {
  const colors = useThemeColors();
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
  const notReadyCount =
    trip.acceptedPackagesCount - trip.executablePackagesCount;
  const packagesSummary =
    notReadyCount > 0
      ? `${formatPackagesCount(trip.acceptedPackagesCount)} · ${trip.executablePackagesCount} ${
          trip.executablePackagesCount === 1 ? "listo" : "listos"
        }`
      : formatPackagesCount(trip.acceptedPackagesCount);

  if (variant === "hero") {
    return (
      <CarrierTripHero
        trip={trip}
        isActive={isActive}
        isToday={isToday}
        startBlockerMessage={
          startBlocker ? tripStartBlockerMessage(trip, startBlocker) : null
        }
        packagesSummary={packagesSummary}
        onStart={onStart}
        isStarting={isStarting}
        errorMessage={errorMessage}
        footer={footer}
        testID={testID}
      />
    );
  }

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
          <Text
            numberOfLines={1}
            className="font-sans-semibold text-[19px] tracking-tight text-fg"
          >
            {tripRouteLabel(trip)}
          </Text>
          <Text
            testID={testID ? `${testID}-packages` : undefined}
            className="font-sans text-[13px] text-fg-3"
          >
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
            accessibilityLabel="Ver mapa del viaje en curso"
            className="h-[52px] w-full flex-row items-center justify-between rounded-[8px] bg-fg px-4 active:opacity-90"
          >
            {/* Ícono y flecha: se lee como una acción que lleva al mapa, no solo un rótulo. */}
            <View className="flex-row items-center gap-2.5">
              <Map size={18} color={colors.bg} strokeWidth={2} />
              <Text className="font-sans-semibold text-[15px] text-bg">
                Ver mapa
              </Text>
            </View>
            <ArrowRight size={18} color={colors.bg} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
      {footer}
    </View>
  );
}

interface CarrierTripHeroProps {
  trip: TripWithAcceptedPackages;
  isActive: boolean;
  isToday: boolean;
  startBlockerMessage: string | null;
  packagesSummary: string;
  onStart?: (trip: TripWithAcceptedPackages) => void | Promise<void>;
  isStarting: boolean;
  errorMessage?: string | null;
  footer?: React.ReactNode;
  testID?: string;
}

/**
 * Variante `hero` de Inicio: el área de arriba (chip, hora, ruta) abre el detalle del viaje; el botón lo inicia.
 * El viaje de hoy manda sobre el resto de la pantalla. Superficie `ink-950`
 * (la única oscura del Inicio, en modo oscuro sube a `ink-800` para despegarse del fondo), título grande,
 * hora de salida junto al chip y un botón lima de 56px con ícono y flecha. El pie (aviso de ubicación del
 * viaje en curso) va en una franja clara debajo: sus colores son los del tema, no los de la tarjeta oscura.
 */
function CarrierTripHero({
  trip,
  isActive,
  isToday,
  startBlockerMessage,
  packagesSummary,
  onStart,
  isStarting,
  errorMessage,
  footer,
  testID,
}: CarrierTripHeroProps) {
  const departureTime = formatTimeOfDay(trip.departureAt);
  const chipLabel = isActive
    ? "En curso"
    : isToday
      ? "Hoy"
      : formatDepartureDateOnly(trip.departureAt);

  return (
    <View
      testID={testID}
      className="overflow-hidden rounded-[20px] bg-ink-950 dark:border dark:border-ink-700 dark:bg-ink-800"
      style={{
        shadowColor: "#0A0A0B",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 20,
        elevation: 6,
      }}
    >
      <View className="gap-4 p-5">
        {/* Tocar la tarjeta abre el viaje (paradas, paquetes, cancelar); solo el botón lo inicia, y con confirmación. */}
        <Pressable
          testID={testID ? `${testID}-open` : undefined}
          onPress={() => router.push(`/carrier/trips/${trip.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Ver el detalle de ${tripRouteLabel(trip)}`}
          className="gap-4 active:opacity-80"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-[24px] flex-row items-center gap-1.5 rounded-full bg-lime-500 px-2.5">
                {isActive ? (
                  <View className="h-1.5 w-1.5 rounded-full bg-ink-950" />
                ) : null}
                <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-ink-950">
                  {chipLabel}
                </Text>
              </View>
              {!isActive && departureTime ? (
                <Text
                  testID={testID ? `${testID}-departure` : undefined}
                  className="font-sans-medium text-[13px] text-paper/70"
                >
                  Sale {departureTime}
                </Text>
              ) : null}
            </View>
            <View className="flex-row items-center gap-1.5">
              <Package
                size={14}
                color="rgba(255,255,255,0.7)"
                strokeWidth={2}
              />
              <Text
                testID={testID ? `${testID}-packages` : undefined}
                className="font-sans-medium text-[13px] text-paper/70"
              >
                {packagesSummary}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            <Text
              numberOfLines={2}
              className="flex-1 font-sans-semibold text-[26px] leading-[31px] tracking-tight text-paper"
            >
              {tripRouteLabel(trip)}
            </Text>
            <ChevronRight
              size={22}
              color="rgba(255,255,255,0.7)"
              strokeWidth={2}
            />
          </View>
        </Pressable>

        {errorMessage ? (
          <ErrorBanner
            testID={testID ? `${testID}-error` : undefined}
            message={errorMessage}
          />
        ) : null}

        {startBlockerMessage ? (
          <View
            testID={testID ? `${testID}-start-blocked` : undefined}
            className="min-h-[56px] w-full items-center justify-center rounded-[14px] bg-paper/10 px-4 py-3"
          >
            <Text className="text-center font-sans-medium text-[14px] text-paper/80">
              {startBlockerMessage}
            </Text>
          </View>
        ) : isActive ? (
          <Pressable
            testID={testID ? `${testID}-view-map-button` : undefined}
            onPress={() =>
              router.push({
                pathname: "/route",
                params: { tripId: trip.id },
              } as never)
            }
            accessibilityRole="button"
            accessibilityLabel="Ver mapa del viaje en curso"
            className="h-[56px] w-full flex-row items-center justify-between rounded-[14px] bg-lime-500 px-5 active:opacity-90"
          >
            <View className="flex-row items-center gap-2.5">
              <Map size={20} color="#0A0A0B" strokeWidth={2} />
              <Text className="font-sans-semibold text-[16px] text-ink-950">
                Ver mapa
              </Text>
            </View>
            <ArrowRight size={20} color="#0A0A0B" strokeWidth={2.2} />
          </Pressable>
        ) : (
          <Pressable
            testID={testID ? `${testID}-start-button` : undefined}
            onPress={() => onStart?.(trip)}
            disabled={isStarting}
            accessibilityRole="button"
            accessibilityLabel="Iniciar viaje"
            className="h-[56px] w-full flex-row items-center justify-between rounded-[14px] bg-lime-500 px-5 active:opacity-90"
          >
            {isStarting ? (
              <View className="flex-1 items-center">
                <ActivityIndicator size="small" color="#0A0A0B" />
              </View>
            ) : (
              <>
                <View className="flex-row items-center gap-2.5">
                  <Navigation size={20} color="#0A0A0B" strokeWidth={2} />
                  <Text className="font-sans-semibold text-[16px] text-ink-950">
                    Iniciar viaje
                  </Text>
                </View>
                <ArrowRight size={20} color="#0A0A0B" strokeWidth={2.2} />
              </>
            )}
          </Pressable>
        )}
      </View>
      {footer ? <View className="bg-bg-sub">{footer}</View> : null}
    </View>
  );
}
