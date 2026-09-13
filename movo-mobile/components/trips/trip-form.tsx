import { router } from "expo-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { PrimaryButton } from "../auth/primary-button";
import { ErrorBanner } from "../ui/error-banner";
import { AddressField } from "../send/address-field";
import { BrandAvatar } from "../vehicle/brand-avatar";
import { GridPattern } from "../ui/grid-pattern";
import { haversineKm } from "../../src/lib/geo";
import { tierFromLabel } from "../../src/data/vehicle-catalog";
import { useMyVehicle } from "../../src/hooks/use-vehicle";
import type { AddressSelection } from "../../src/types/address-selection";
import type { CreateTripInput } from "../../src/api/trips-client";
import { DepartureDateTimePicker } from "./departure-date-time-picker";

/** Mismo umbral que valida el backend (`trips.service.ts#distanceMeters`,
 * `movo-svc-shipments`) — repetido acá a propósito (mismo criterio que
 * `MIN_PICKUP_DELIVERY_DISTANCE_KM` de `address-step.tsx`, MOVO-83/126) para avisar
 * apenas se elige el destino, sin esperar el 400 del submit. */
const MIN_ORIGIN_DESTINATION_DISTANCE_KM = 0.1;

function defaultDepartureAt(): Date {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setMinutes(0, 0, 0);
  return tomorrow;
}

function areTooClose(origin: AddressSelection | null, destination: AddressSelection | null): boolean {
  if (!origin || !destination) return false;
  return haversineKm(origin.lat, origin.lng, destination.lat, destination.lng) < MIN_ORIGIN_DESTINATION_DISTANCE_KM;
}

export interface TripFormInitialValues {
  origin: AddressSelection;
  destination: AddressSelection;
  departureAt: Date;
}

interface TripFormProps {
  initialValues?: TripFormInitialValues;
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: CreateTripInput) => void;
  testID?: string;
}

/**
 * Formulario compartido de declarar/editar viaje (MOVO-162, AC1/AC3) — origen/destino
 * reusan `AddressField` (mismo picker de mapa que el wizard de envío, MOVO-83/MOVO-121,
 * ya desacoplado del store del wizard), fecha/hora de salida usa
 * `DepartureDateTimePicker` (nuevo, un instante único — no la ventana de 3 franjas de
 * `TimeWindowPicker`). Solo dueño de los campos y su validación de cliente; la mutación
 * real y el mapeo de errores de API viven en las pantallas `new.tsx`/`[id]/edit.tsx`
 * que lo montan.
 */
export function TripForm({
  initialValues,
  submitLabel,
  submitting,
  error,
  onSubmit,
  testID,
}: TripFormProps) {
  const [origin, setOrigin] = useState<AddressSelection | null>(initialValues?.origin ?? null);
  const [destination, setDestination] = useState<AddressSelection | null>(initialValues?.destination ?? null);
  const [departureAt, setDepartureAt] = useState<Date>(initialValues?.departureAt ?? defaultDepartureAt());
  const { data: vehicle } = useMyVehicle();

  const tooClose = areTooClose(origin, destination);
  const inThePast = departureAt.getTime() <= Date.now();
  const isValid = !!origin && !!destination && !tooClose && !inThePast && !!vehicle;

  const handleSubmit = () => {
    if (!isValid || !origin || !destination || !vehicle) return;
    onSubmit({
      originAddress: origin.address,
      originLat: origin.lat,
      originLng: origin.lng,
      destinationAddress: destination.address,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      departureAt: departureAt.toISOString(),
      vehicleType: `${vehicle.brand} ${vehicle.model}`,
    });
  };

  return (
    <View testID={testID} className="flex-1">
      <ScrollView
        className="flex-1 px-5"
        contentContainerClassName="gap-5 pt-4 pb-8"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ErrorBanner testID={testID ? `${testID}-error` : undefined} message={error} />

        <View className="gap-3">
          <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
            Ruta
          </Text>
          <AddressField
            testID={testID ? `${testID}-origin` : undefined}
            label="Origen"
            dotColor="#0A0A0B"
            value={origin}
            onChange={setOrigin}
          />
          <AddressField
            testID={testID ? `${testID}-destination` : undefined}
            label="Destino"
            dotColor="#C6F24A"
            value={destination}
            onChange={setDestination}
          />
          {tooClose ? (
            <Text
              testID={testID ? `${testID}-too-close-error` : undefined}
              className="font-sans text-[12px] text-danger-500"
            >
              El origen y el destino están muy cerca — elegí ubicaciones distintas.
            </Text>
          ) : null}
        </View>

        <View className="gap-2.5">
          <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
            Salida
          </Text>
          <DepartureDateTimePicker
            testID={testID ? `${testID}-departure` : undefined}
            value={departureAt}
            onChange={setDepartureAt}
          />
          {inThePast ? (
            <Text
              testID={testID ? `${testID}-past-error` : undefined}
              className="font-sans text-[12px] text-danger-500"
            >
              La fecha y hora de salida tiene que ser futura.
            </Text>
          ) : null}
        </View>

        <View className="gap-2.5">
          <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
            Vehículo
          </Text>
          {vehicle ? (
            <View className="overflow-hidden rounded-[10px] border-[1.5px] border-ink-950">
              <View className="flex-row items-center gap-2 rounded-t-[8.5px] bg-lime-500 px-3.5 py-2.5">
                <CheckCircle2 size={14} color="#0A0A0B" strokeWidth={2.6} />
                <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-ink-950">
                  Seleccionado automáticamente
                </Text>
              </View>
              <View className="flex-row items-center gap-3 rounded-b-[8.5px] bg-white px-3.5 py-[15px]">
                <BrandAvatar brand={vehicle.brand} size={40} />
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-sans-medium text-[15px] text-ink-950">
                    {vehicle.brand} {vehicle.model}
                  </Text>
                  <Text className="font-mono text-[12px] tracking-[0.05em] text-ink-600">
                    {vehicle.licensePlate} · {vehicle.cargoCapacityLabel}
                  </Text>
                </View>
                <View className="h-10 min-w-10 items-center justify-center rounded-lg bg-ink-950 px-1.5">
                  <Text className="font-mono-semibold text-[14px] text-lime-500">
                    {tierFromLabel(vehicle.cargoCapacityLabel).id}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View>
              <View className="relative overflow-hidden rounded-[10px] border-[1.5px] border-ink-950/[0.18] bg-ink-50 p-[18px]">
                <GridPattern color="#0A0A0B" opacity={0.05} />
                <View className="mb-3.5 flex-row items-start gap-[11px]">
                  <AlertTriangle size={20} color="#0A0A0B" strokeWidth={2} />
                  <View className="min-w-0 flex-1 gap-1.5">
                    <Text className="font-sans-semibold text-[16px] tracking-[-0.01em] text-ink-950">
                      Necesitás una ficha de vehículo
                    </Text>
                    <Text className="font-sans text-[13.5px] leading-[20px] text-ink-600">
                      Para declarar un viaje tenemos que saber qué llevás y cuánto entra. Registrá tu auto una vez y
                      listo.
                    </Text>
                  </View>
                </View>
                <Pressable
                  testID={testID ? `${testID}-register-vehicle` : undefined}
                  onPress={() => router.push("/vehicle-info")}
                  className="w-full items-center justify-center rounded-lg bg-ink-950 py-3"
                >
                  <Text className="font-sans-semibold text-[14.5px] text-white">Registrar ficha de vehículo</Text>
                </Pressable>
              </View>
              <Text className="mt-2.5 font-sans text-[12.5px] leading-[19px] text-fg-3">
                Te llevamos a la ficha y volvés acá con el viaje como lo dejaste.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <PrimaryButton
        testID={testID ? `${testID}-submit` : undefined}
        label={submitLabel}
        onPress={handleSubmit}
        disabled={!isValid}
        loading={submitting}
      />
    </View>
  );
}
