import { MapPin } from "lucide-react-native";
import { Text, View } from "react-native";
import { haversineKm } from "../../../src/lib/geo";
import { useShipmentWizardStore } from "../../../src/store/shipment-wizard-store";
import type { AddressSelection } from "../../../src/types/address-selection";
import { AddressField } from "../address-field";
import { TimeWindowPicker } from "../time-window-picker";

function isValidSelection(selection: AddressSelection | null): boolean {
  if (!selection) return false;
  return (
    selection.address.trim().length > 0 &&
    Number.isFinite(selection.lat) &&
    selection.lat >= -90 &&
    selection.lat <= 90 &&
    Number.isFinite(selection.lng) &&
    selection.lng >= -180 &&
    selection.lng <= 180
  );
}

// MOVO-126: mismo umbral que rechaza el backend (`shipments.service.ts`) — retiro y
// entrega a menos de 100m se tratan como la misma ubicación. Repetido acá a propósito
// (no hay una llamada al backend para esto, sería un round-trip innecesario por algo
// que ya tenemos ambos puntos en el cliente) para dar el error apenas se elige la
// segunda dirección, en vez de recién al fallar el submit del resumen.
const MIN_PICKUP_DELIVERY_DISTANCE_KM = 0.1;

function arePickupAndDeliveryTooClose(pickup: AddressSelection | null, delivery: AddressSelection | null): boolean {
  if (!isValidSelection(pickup) || !isValidSelection(delivery)) return false;
  return haversineKm(pickup!.lat, pickup!.lng, delivery!.lat, delivery!.lng) < MIN_PICKUP_DELIVERY_DISTANCE_KM;
}

/** AC5: selección de direcciones con obtención de coordenadas + franja horaria de
 * retiro — mismas reglas que el backend valida en `shipments.service.ts` (MOVO-80):
 * la fecha no puede estar en el pasado y el fin de la ventana tiene que ser posterior
 * al inicio (acá solo se ofrecen ventanas ya válidas entre sí, ver
 * `TimeWindowPicker`). */
export function isAddressStepValid(state: {
  pickup: AddressSelection | null;
  delivery: AddressSelection | null;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
}): boolean {
  if (!isValidSelection(state.pickup) || !isValidSelection(state.delivery))
    return false;
  if (arePickupAndDeliveryTooClose(state.pickup, state.delivery)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.pickupDate)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pickupDay = new Date(`${state.pickupDate}T00:00:00`);
  if (pickupDay < today) return false;
  return state.pickupTimeWindowStart !== "" && state.pickupTimeWindowEnd !== "";
}

export function AddressStep() {
  const {
    pickup,
    delivery,
    pickupDate,
    pickupTimeWindowStart,
    pickupTimeWindowEnd,
    setPickup,
    setDelivery,
    setPickupDate,
    setPickupTimeWindowStart,
    setPickupTimeWindowEnd,
  } = useShipmentWizardStore();

  const tooClose = arePickupAndDeliveryTooClose(pickup, delivery);

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <MapPin size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">
          ¿De dónde a dónde?
        </Text>
        <Text className="font-sans text-body text-fg-2">
          Elegí retiro y entrega — podés usar tu ubicación actual, cargarla a
          mano o corregir el punto exacto en el mapa.
        </Text>
      </View>

      <View className="gap-3">
        <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          Ruta
        </Text>
        <AddressField
          testID="address-step-pickup"
          label="Retiro"
          dotColor="#0A0A0B"
          value={pickup}
          onChange={setPickup}
        />
        <AddressField
          testID="address-step-delivery"
          label="Entrega"
          dotColor="#C6F24A"
          value={delivery}
          onChange={setDelivery}
        />
        {tooClose ? (
          <Text testID="address-step-same-location-error" className="font-sans text-[12px] text-danger-500">
            El retiro y la entrega están muy cerca — elegí ubicaciones distintas.
          </Text>
        ) : null}
      </View>

      <View className="gap-2.5 rounded-[10px] border border-border-strong bg-bg-sub p-4">
        <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          ¿Cuándo pasamos a buscarlo?
        </Text>
        <TimeWindowPicker
          testID="address-step-time-window"
          pickupDate={pickupDate}
          timeWindowStart={pickupTimeWindowStart}
          timeWindowEnd={pickupTimeWindowEnd}
          onChangeDate={setPickupDate}
          onChangeWindow={(start, end) => {
            setPickupTimeWindowStart(start);
            setPickupTimeWindowEnd(end);
          }}
        />
      </View>
    </View>
  );
}
