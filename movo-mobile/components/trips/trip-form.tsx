import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { PrimaryButton } from "../auth/primary-button";
import { ErrorBanner } from "../ui/error-banner";
import { SelectField } from "../ui/select-field";
import { AddressField } from "../send/address-field";
import { haversineKm } from "../../src/lib/geo";
import type { AddressSelection } from "../../src/types/address-selection";
import type { CreateTripInput } from "../../src/api/trips-client";
import { DepartureDateTimePicker } from "./departure-date-time-picker";

/** Mismo umbral que valida el backend (`trips.service.ts#distanceMeters`,
 * `movo-svc-shipments`) — repetido acá a propósito (mismo criterio que
 * `MIN_PICKUP_DELIVERY_DISTANCE_KM` de `address-step.tsx`, MOVO-83/126) para avisar
 * apenas se elige el destino, sin esperar el 400 del submit. */
const MIN_ORIGIN_DESTINATION_DISTANCE_KM = 0.1;

/** Lista fija — `vehicleType` es un `string` libre en el backend (sin enum,
 * `minLength: 1, maxLength: 50`), se ofrece acotado a estas opciones para no pedirle
 * al usuario que tipee texto libre. Fácil de ajustar si el equipo prefiere otro set. */
const VEHICLE_TYPE_OPTIONS = ["Auto", "Camioneta", "Moto", "Camión"] as const;

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
  vehicleType: string;
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
  const [vehicleType, setVehicleType] = useState(initialValues?.vehicleType ?? "");

  const tooClose = areTooClose(origin, destination);
  const inThePast = departureAt.getTime() <= Date.now();
  const isValid = !!origin && !!destination && !tooClose && !inThePast && vehicleType.trim().length > 0;

  const handleSubmit = () => {
    if (!isValid || !origin || !destination) return;
    onSubmit({
      originAddress: origin.address,
      originLat: origin.lat,
      originLng: origin.lng,
      destinationAddress: destination.address,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      departureAt: departureAt.toISOString(),
      vehicleType,
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

        <SelectField
          testID={testID ? `${testID}-vehicle-type` : undefined}
          label="Tipo de vehículo"
          value={vehicleType}
          options={VEHICLE_TYPE_OPTIONS}
          onChange={setVehicleType}
          placeholder="Elegí un vehículo"
        />
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
