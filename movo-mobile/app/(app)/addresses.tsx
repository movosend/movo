import { router } from "expo-router";
import {
  ChevronLeft,
  MapPin,
  MapPinOff,
  Pencil,
  Plus,
  Star,
  Trash2,
  WifiOff,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmAddAddressSheet } from "../../components/addresses/confirm-add-address-sheet";
import { EditAddressSheet } from "../../components/addresses/edit-address-sheet";
import { PrimaryButton } from "../../components/auth/primary-button";
import { AddressSearchSheet } from "../../components/send/address-search-sheet";
import type { Address } from "../../src/api/addresses-client";
import {
  useAddresses,
  useDeleteAddress,
  useUpdateAddress,
} from "../../src/hooks/use-addresses";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { AddressSelection } from "../../src/types/address-selection";

/**
 * Gestión de direcciones guardadas (MOVO-121), sibling de `license-kyc.tsx`/`send.tsx`
 * dentro de `app/(app)/` (no de `(tabs)/`) — hereda el guard de sesión de
 * `app/(app)/_layout.tsx`. Reemplaza el placeholder de "Direcciones guardadas" en
 * Perfil → Configuración (`profile-settings-section.tsx`, MOVO-78).
 *
 * "Agregar dirección" reusa `AddressSearchSheet` (MOVO-83, desacoplado del wizard en
 * este mismo ticket) para elegir (búsqueda/GPS/guardada), pero no guarda apenas se
 * elige — pasa a `ConfirmAddAddressSheet`, que muestra el mapa para ajustar el pin y
 * recién ahí guarda de forma explícita (fix de feedback: antes se guardaba
 * automáticamente al elegir, sin mostrar nunca el mapa, y un error de guardado quedaba
 * oculto detrás del `Modal` del buscador en vez de mostrarse en el paso donde ocurre).
 */
export default function SavedAddressesScreen() {
  const colors = useThemeColors();
  const { data: addresses, isLoading, isError, refetch } = useAddresses();
  const updateAddress = useUpdateAddress();
  const deleteAddress = useDeleteAddress();

  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<AddressSelection | null>(null);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);

  const handleAddSelect = (selection: AddressSelection) => {
    setSearchOpen(false);
    setPendingSelection(selection);
  };

  const handleSetDefault = (address: Address) => {
    if (address.isDefault) return;
    updateAddress.mutate({ id: address.id, body: { isDefault: true } });
  };

  const handleDelete = (address: Address) => {
    Alert.alert(
      "¿Eliminar esta dirección?",
      "No vas a poder deshacer esta acción.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deleteAddress.mutate(address.id),
        },
      ],
    );
  };

  const hasAddresses = !!addresses && addresses.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="addresses-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">
          Direcciones guardadas
        </Text>
      </View>
      <Text className="px-5 pb-4 font-sans text-[13px] text-fg-3">
        Guardá tus direcciones frecuentes para completarlas más rápido al crear
        un envío. La marcada con estrella es tu dirección por defecto.
      </Text>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.fg3} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">
            No pudimos cargar tus direcciones.
          </Text>
          <Text
            testID="addresses-retry"
            onPress={() => refetch()}
            className="font-sans-medium text-small text-fg"
          >
            Reintentar
          </Text>
        </View>
      ) : !hasAddresses ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <MapPinOff size={26} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">
            Todavía no guardaste ninguna dirección.
          </Text>
          <Pressable
            testID="addresses-empty-add"
            onPress={() => setSearchOpen(true)}
            className="flex-row items-center gap-1.5 rounded-full bg-bg-mute px-4 py-2.5"
          >
            <Plus size={16} strokeWidth={2} color={colors.fg1} />
            <Text className="font-sans-medium text-[13px] text-fg">
              Agregar dirección
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {addresses.map((address) => (
            <View
              key={address.id}
              testID={`addresses-row-${address.id}`}
              className="flex-row items-center gap-3 border-b border-border py-3.5"
            >
              <Pressable
                testID={`addresses-row-${address.id}-star`}
                onPress={() => handleSetDefault(address)}
                hitSlop={8}
              >
                {address.isDefault ? (
                  <Star size={18} color="#C6F24A" fill="#C6F24A" />
                ) : (
                  <MapPin size={18} color={colors.fg2} strokeWidth={1.8} />
                )}
              </Pressable>
              <View className="flex-1">
                <Text
                  numberOfLines={1}
                  className="font-sans-medium text-[14px] text-fg"
                >
                  {address.label ?? address.street}
                </Text>
                <Text
                  numberOfLines={1}
                  className="mt-0.5 font-sans text-[12px] text-fg-3"
                >
                  {address.street} {address.streetNumber}, {address.city}
                </Text>
              </View>
              <Pressable
                testID={`addresses-row-${address.id}-edit`}
                onPress={() => setEditingAddress(address)}
                hitSlop={8}
                className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
              >
                <Pencil size={15} color={colors.fg2} strokeWidth={1.8} />
              </Pressable>
              <Pressable
                testID={`addresses-row-${address.id}-delete`}
                onPress={() => handleDelete(address)}
                hitSlop={8}
                className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
              >
                <Trash2 size={15} color={colors.fg2} strokeWidth={1.8} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {hasAddresses ? (
        <PrimaryButton
          testID="addresses-add"
          label="Agregar dirección"
          onPress={() => setSearchOpen(true)}
        />
      ) : null}

      <AddressSearchSheet
        testID="addresses-search-sheet"
        visible={searchOpen}
        label="Nueva dirección"
        savedAddresses={addresses}
        onClose={() => setSearchOpen(false)}
        onSelect={handleAddSelect}
      />

      <ConfirmAddAddressSheet
        testID="addresses-confirm-add-sheet"
        visible={pendingSelection !== null}
        selection={pendingSelection}
        onClose={() => setPendingSelection(null)}
        onSaved={() => setPendingSelection(null)}
      />

      <EditAddressSheet
        testID="addresses-edit-sheet"
        visible={editingAddress !== null}
        address={editingAddress}
        onClose={() => setEditingAddress(null)}
      />
    </SafeAreaView>
  );
}
