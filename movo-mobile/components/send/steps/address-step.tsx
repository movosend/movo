import { MapPin } from "lucide-react-native";
import { Text, View } from "react-native";
import { useShipmentWizardStore, type AddressSelection } from "../../../src/store/shipment-wizard-store";
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
  if (!isValidSelection(state.pickup) || !isValidSelection(state.delivery)) return false;
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

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <MapPin size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">¿De dónde a dónde?</Text>
        <Text className="font-sans text-body text-fg-2">
          Elegí retiro y entrega — podés usar tu ubicación actual, cargarla a mano o
          corregir el punto exacto en el mapa.
        </Text>
      </View>

      <View className="gap-3">
        <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">Ruta</Text>
        <AddressField testID="address-step-pickup" label="Retiro" dotColor="#0A0A0B" value={pickup} onChange={setPickup} />
        <AddressField
          testID="address-step-delivery"
          label="Entrega"
          dotColor="#C6F24A"
          value={delivery}
          onChange={setDelivery}
        />
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
