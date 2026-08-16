import { ChevronRight, Star } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useCreateAddress, useAddresses } from "../../src/hooks/use-addresses";
import type { AddressSelection } from "../../src/store/shipment-wizard-store";
import { AddressSearchSheet } from "./address-search-sheet";
import { CollapsibleMapRow } from "./collapsible-map-row";

interface AddressFieldProps {
  label: string;
  dotColor: string;
  value: AddressSelection | null;
  onChange: (selection: AddressSelection | null) => void;
  testID?: string;
}

/**
 * Un bloque de dirección (retiro o entrega) del paso de direcciones del wizard
 * (AC5), rediseñado estilo Uber/PedidosYa tras feedback de UI (MOVO-83): una fila
 * colapsada que abre `AddressSearchSheet` (búsqueda de texto libre + Google Places,
 * GPS, direcciones guardadas) a pantalla completa, en vez de mostrar de una un
 * formulario manual de 6 campos. "Ajustar en el mapa" queda como escape hatch
 * opcional para corregir el pin exacto, reusando `CollapsibleMapRow` tal cual.
 */
export function AddressField({ label, dotColor, value, onChange, testID }: AddressFieldProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const { data: savedAddresses } = useAddresses();
  const createAddress = useCreateAddress();

  const handleSelect = (selection: AddressSelection) => {
    onChange(selection);
    setSheetOpen(false);
    setMapOpen(false);
    setSaved(false);
  };

  const handleSaveAddress = () => {
    if (!value) return;
    // Places solo devuelve `formattedAddress` (sin componentes estructurados) — split
    // best-effort en vez de una dirección estructurada real, simplificación conocida
    // documentada acá, no un bug.
    const [firstSegment, ...rest] = value.address.split(",").map((s) => s.trim());
    createAddress.mutate({
      label: null,
      isDefault: false,
      street: firstSegment ?? value.address,
      streetNumber: "",
      floorApartment: null,
      city: rest[0] ?? "",
      province: "",
      postalCode: "",
      country: "Argentina",
      lat: value.lat,
      long: value.lng,
    });
    setSaved(true);
  };

  return (
    <View className="gap-2">
      <Pressable
        testID={testID}
        onPress={() => setSheetOpen(true)}
        className="flex-row items-center gap-3 rounded-[10px] border border-border-strong bg-bg px-3.5 py-3.5"
      >
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
        <View className="flex-1">
          <Text className="mb-0.5 font-sans text-[11px] text-fg-3">{label}</Text>
          <Text
            className={`font-sans-medium text-[15px] ${value ? "text-fg" : "text-fg-3"}`}
            numberOfLines={1}
          >
            {value?.address || "Tocá para buscar la dirección"}
          </Text>
        </View>
        <ChevronRight size={18} color="#8A8A93" strokeWidth={1.8} />
      </Pressable>

      {value ? (
        <View className="flex-row flex-wrap items-center gap-4 px-1">
          <Pressable testID={testID ? `${testID}-adjust-map` : undefined} onPress={() => setMapOpen((v) => !v)}>
            <Text className="font-sans-medium text-[12px] text-fg-2">
              {mapOpen ? "Ocultar mapa" : "Ajustar en el mapa"}
            </Text>
          </Pressable>
          {value.source !== "saved" ? (
            <Pressable
              testID={testID ? `${testID}-save-address` : undefined}
              onPress={handleSaveAddress}
              disabled={saved || createAddress.isPending}
              className="flex-row items-center gap-1"
            >
              <Star size={12} color={saved ? "#C6F24A" : "#8A8A93"} fill={saved ? "#C6F24A" : "none"} />
              <Text className="font-sans-medium text-[12px] text-fg-2">
                {saved ? "Dirección guardada" : "Guardar para la próxima"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {mapOpen ? (
        <View className="rounded-[10px] border border-border-strong bg-bg">
          <CollapsibleMapRow
            testID={testID ? `${testID}-map` : undefined}
            dotColor={dotColor}
            label={label}
            address={value?.address ?? ""}
            lat={value?.lat ?? null}
            lng={value?.lng ?? null}
            autoExpand
            onConfirm={(lat, lng) => {
              onChange(value ? { ...value, lat, lng, source: "map-pin" } : { address: "Ubicación en el mapa", lat, lng, source: "map-pin" });
              setMapOpen(false);
            }}
          />
        </View>
      ) : null}

      <AddressSearchSheet
        testID={testID ? `${testID}-sheet` : undefined}
        visible={sheetOpen}
        label={label}
        savedAddresses={savedAddresses}
        onClose={() => setSheetOpen(false)}
        onSelect={handleSelect}
      />
    </View>
  );
}
