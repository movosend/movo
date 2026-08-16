import { Package } from "lucide-react-native";
import { Text, TextInput, View } from "react-native";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useShipmentWizardStore } from "../../../src/store/shipment-wizard-store";
import { CategoryGrid } from "../category-grid";
import { DimensionInputs } from "../dimension-inputs";
import { WeightStepper } from "../weight-stepper";

/** AC3: tipo de paquete (3 categorías reales), dimensiones, peso aproximado,
 * descripción opcional. */
export function isPackageStepValid(state: {
  packageType: string | null;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}): boolean {
  const weight = Number(state.weightKg);
  const length = Number(state.lengthCm);
  const width = Number(state.widthCm);
  const height = Number(state.heightCm);
  return (
    state.packageType !== null &&
    Number.isFinite(weight) &&
    weight >= 0.1 &&
    weight <= 30 &&
    Number.isFinite(length) &&
    length >= 1 &&
    length <= 150 &&
    Number.isFinite(width) &&
    width >= 1 &&
    width <= 150 &&
    Number.isFinite(height) &&
    height >= 1 &&
    height <= 150
  );
}

export function PackageStep() {
  const colors = useThemeColors();
  const {
    packageType,
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
    description,
    setPackageType,
    setWeightKg,
    setLengthCm,
    setWidthCm,
    setHeightCm,
    setDescription,
  } = useShipmentWizardStore();

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <Package size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">¿Qué vas a enviar?</Text>
        <Text className="font-sans text-body text-fg-2">
          Contanos el tipo de paquete, sus dimensiones y peso aproximado.
        </Text>
      </View>

      <View>
        <Text className="mb-2 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          Tipo de paquete
        </Text>
        <CategoryGrid testID="package-step-category" value={packageType} onChange={setPackageType} />
      </View>

      <View>
        <Text className="mb-2 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          Peso aproximado
        </Text>
        <WeightStepper testID="package-step-weight" value={weightKg} onChange={setWeightKg} />
      </View>

      <View>
        <Text className="mb-2 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          Dimensiones (cm)
        </Text>
        <DimensionInputs
          testID="package-step-dimensions"
          lengthCm={lengthCm}
          widthCm={widthCm}
          heightCm={heightCm}
          onChangeLength={setLengthCm}
          onChangeWidth={setWidthCm}
          onChangeHeight={setHeightCm}
        />
      </View>

      <View>
        <Text className="mb-2 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          Descripción (opcional)
        </Text>
        <TextInput
          testID="package-step-description"
          value={description}
          onChangeText={setDescription}
          placeholder="Ej: remera de algodón, zapatillas talle 42…"
          placeholderTextColor={colors.fg3}
          maxLength={500}
          multiline
          className="min-h-[80px] rounded-lg border border-border-strong px-3.5 py-3 font-sans text-body text-fg"
        />
      </View>
    </View>
  );
}
