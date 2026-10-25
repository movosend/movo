import { View } from "react-native";
import { SelectField } from "../ui/select-field";
import {
  DIMENSION_OPTION_LABELS,
  dimensionFieldText,
  dimensionLabel,
  dimensionValueFromLabel,
} from "../../src/lib/package-dimensions";

interface DimensionInputsProps {
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  onChangeLength: (value: string) => void;
  onChangeWidth: (value: string) => void;
  onChangeHeight: (value: string) => void;
  testID?: string;
}

const FIELDS = [
  { key: "length", label: "Largo" },
  { key: "width", label: "Ancho" },
  { key: "height", label: "Alto" },
] as const;

/**
 * Largo, ancho y alto como desplegables de 10 a 300 cm de a 10, más "Más de 300 cm" (MOVO-317).
 * Sin máximo duro: el tamaño lo decide cada transportista al ver el envío. Las opciones salen de
 * `@movo/shared` (vía `package-dimensions.ts`), no se escriben a mano acá.
 */
export function DimensionInputs({
  lengthCm,
  widthCm,
  heightCm,
  onChangeLength,
  onChangeWidth,
  onChangeHeight,
  testID,
}: DimensionInputsProps) {
  const valuesByKey = { length: lengthCm, width: widthCm, height: heightCm };
  const onChangeByKey = {
    length: onChangeLength,
    width: onChangeWidth,
    height: onChangeHeight,
  };

  return (
    <View testID={testID} className="flex-row gap-2.5">
      {FIELDS.map(({ key, label }) => (
        <SelectField
          key={key}
          testID={testID ? `${testID}-${key}` : undefined}
          label={label}
          value={dimensionLabel(valuesByKey[key])}
          displayValue={dimensionFieldText(valuesByKey[key])}
          options={DIMENSION_OPTION_LABELS}
          onChange={(selected) => onChangeByKey[key](dimensionValueFromLabel(selected))}
          placeholder="Elegir"
          containerClassName="flex-1 gap-1.5"
        />
      ))}
    </View>
  );
}
