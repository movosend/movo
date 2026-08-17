import { Package } from "lucide-react-native";
import { useRef } from "react";
import { Text, TextInput, View } from "react-native";
import type { OnFocusInput } from "../../../src/hooks/use-keyboard-scroll";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useShipmentWizardStore } from "../../../src/store/shipment-wizard-store";
import { CategoryGrid } from "../category-grid";
import { DimensionInputs } from "../dimension-inputs";
import { WeightStepper } from "../weight-stepper";

const DEFAULT_LETTER_WEIGHT_KG = "0.1";
// Medidas de un sobre A4 tipo carta — el paso de peso/dimensiones se oculta para
// esta categoría (AC3), pero el backend igual exige `weightKg`/`*Cm` dentro de sus
// mínimos (`shipments.schema.ts`, MOVO-80).
const DEFAULT_LETTER_LENGTH_CM = "30";
const DEFAULT_LETTER_WIDTH_CM = "21";
const DEFAULT_LETTER_HEIGHT_CM = "1";

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

interface PackageStepProps {
  onFocusInput: OnFocusInput;
}

export function PackageStep({ onFocusInput }: PackageStepProps) {
  const colors = useThemeColors();
  const descriptionRef = useRef<TextInput>(null);
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

  const isLetter = packageType === "letter_document";

  const handlePackageTypeChange = (type: typeof packageType) => {
    setPackageType(type);
    // AC3: una carta/documento no pesa/mide lo suficiente como para pedirle esos
    // datos al usuario — se fijan valores dentro de los mínimos del backend en vez
    // de dejar los campos vacíos, para no bloquear la validación del paso al
    // ocultar el stepper y las dimensiones.
    if (type === "letter_document") {
      setWeightKg(DEFAULT_LETTER_WEIGHT_KG);
      setLengthCm(DEFAULT_LETTER_LENGTH_CM);
      setWidthCm(DEFAULT_LETTER_WIDTH_CM);
      setHeightCm(DEFAULT_LETTER_HEIGHT_CM);
    }
  };

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <Package size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">
          ¿Qué vas a enviar?
        </Text>
        <Text className="font-sans text-body text-fg-2">
          Contanos el tipo de paquete, sus dimensiones y peso aproximado.
        </Text>
      </View>

      <View>
        <Text className="mb-2 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          Tipo de paquete
        </Text>
        <CategoryGrid
          testID="package-step-category"
          value={packageType}
          onChange={handlePackageTypeChange}
        />
      </View>

      {packageType ? (
        <>
          {isLetter ? null : (
            <View>
              <Text className="mb-2 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
                Peso aproximado
              </Text>
              <WeightStepper
                testID="package-step-weight"
                value={weightKg}
                onChange={setWeightKg}
              />
            </View>
          )}

          {isLetter ? null : (
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
                onFocusInput={onFocusInput}
              />
            </View>
          )}
        </>
      ) : null}

      <View>
        <Text className="mb-2 font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
          Descripción (opcional)
        </Text>
        <TextInput
          ref={descriptionRef}
          testID="package-step-description"
          value={description}
          onChangeText={setDescription}
          onFocus={() => onFocusInput(descriptionRef)}
          placeholder="Sumar una descripcion ayuda a que el transportista sepa que esperar y mejora las chaces de que recibas buenas ofertas."
          placeholderTextColor={colors.fg3}
          maxLength={500}
          multiline
          textAlignVertical="top"
          className="min-h-[80px] rounded-lg border border-border-strong px-3.5 py-3 font-sans text-body text-fg"
          style={{ includeFontPadding: false }}
        />
      </View>
    </View>
  );
}
