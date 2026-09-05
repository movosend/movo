import { router } from "expo-router";
import { ChevronLeft, WifiOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { ProfileSkeleton } from "../../components/profile/profile-skeleton";
import { ErrorBanner } from "../../components/ui/error-banner";
import { SuccessBanner } from "../../components/ui/success-banner";
import { TextField } from "../../components/ui/text-field";
import { useKeyboardScroll } from "../../src/hooks/use-keyboard-scroll";
import { useMyVehicle, useUpsertVehicle } from "../../src/hooks/use-vehicle";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";

/**
 * Ficha de vehículo del transportista (MOVO-172, `svc-users` todavía sin
 * implementar — el submit va a fallar contra un endpoint que hoy no existe, ver
 * esa issue para el contrato propuesto). Formulario atómico con botón Guardar
 * (no guardado al blur como `edit.tsx`): las 4 piezas del vehículo solo tienen
 * sentido juntas, no una a una.
 */
export default function VehicleInfoScreen() {
  const colors = useThemeColors();
  const { scrollRef, onScroll } = useKeyboardScroll();
  const { data: vehicle, isLoading, isError, refetch } = useMyVehicle();
  const upsertVehicle = useUpsertVehicle({
    onSuccess: () => setSuccessMessage("Guardamos tu vehículo."),
  });

  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [cargoCapacityLabel, setCargoCapacityLabel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicle) return;
    setBrand(vehicle.brand);
    setModel(vehicle.model);
    setCargoCapacityLabel(vehicle.cargoCapacityLabel);
    setLicensePlate(vehicle.licensePlate);
  }, [vehicle]);

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile/edit");
  }

  const canSubmit = brand.trim() && model.trim() && cargoCapacityLabel.trim() && licensePlate.trim();

  async function handleSubmit() {
    setErrorMessage(null);
    try {
      await upsertVehicle.mutateAsync({
        brand: brand.trim(),
        model: model.trim(),
        cargoCapacityLabel: cargoCapacityLabel.trim(),
        licensePlate: licensePlate.trim().toUpperCase(),
      });
    } catch (err) {
      setErrorMessage(friendlyErrorMessage(err, "No pudimos guardar tu vehículo. Intentá de nuevo."));
    }
  }

  if (isLoading) return <ProfileSkeleton testID="vehicle-info-skeleton" />;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="vehicle-info-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Ficha de vehículo</Text>
      </View>

      {isError ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">
            No pudimos cargar tu vehículo.
          </Text>
          <Text
            testID="vehicle-info-retry"
            onPress={() => refetch()}
            className="font-sans-medium text-small text-fg"
          >
            Reintentar
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
        >
          <ScrollView
            ref={scrollRef}
            testID="vehicle-info-content"
            className="flex-1 px-5"
            contentContainerClassName="pb-8 pt-2"
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            <SuccessBanner
              testID="vehicle-info-success"
              message={successMessage}
              onDismiss={() => setSuccessMessage(null)}
            />
            <ErrorBanner testID="vehicle-info-error" message={errorMessage} />

            <Text className="mb-4 font-sans text-[13px] leading-[18px] text-fg-3">
              Esta ficha se muestra en tu perfil público: quien recibe su paquete
              puede verificar el vehículo antes de entregártelo.
            </Text>

            <TextField
              testID="vehicle-info-brand"
              label="Marca"
              placeholder="Ej: Renault"
              value={brand}
              onChangeText={setBrand}
              autoCapitalize="words"
              maxLength={40}
            />
            <TextField
              testID="vehicle-info-model"
              label="Modelo"
              placeholder="Ej: Sandero blanco"
              value={model}
              onChangeText={setModel}
              autoCapitalize="words"
              maxLength={40}
            />
            <TextField
              testID="vehicle-info-cargo-capacity"
              label="Capacidad de carga"
              placeholder="Ej: Baúl mediano · hasta 15 kg"
              value={cargoCapacityLabel}
              onChangeText={setCargoCapacityLabel}
              maxLength={60}
            />
            <TextField
              testID="vehicle-info-license-plate"
              label="Patente"
              placeholder="Ej: AB 123 CD"
              value={licensePlate}
              onChangeText={setLicensePlate}
              autoCapitalize="characters"
              maxLength={10}
            />
          </ScrollView>

          <PrimaryButton
            testID="vehicle-info-submit"
            label="Guardar vehículo"
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            loading={upsertVehicle.isPending}
          />
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
