import { act, fireEvent, render } from "@testing-library/react-native";
import { useState } from "react";
import { DimensionInputs } from "../components/send/dimension-inputs";
import { isPackageStepValid, PackageStep } from "../components/send/steps/package-step";
import { WeightStepper } from "../components/send/weight-stepper";
import {
  DIMENSION_OPTION_LABELS,
  OVERSIZED_DIMENSION,
  OVERSIZED_DIMENSION_LABEL,
  dimensionToCm,
  dimensionValueFromLabel,
  formatPackageDimensions,
  hasOversizedDimension,
} from "../src/lib/package-dimensions";
import { useShipmentWizardStore } from "../src/store/shipment-wizard-store";

jest.mock("../src/hooks/use-theme-colors", () => ({
  useThemeColors: () => ({ fg1: "#111111", fg2: "#555555", fg3: "#888888" }),
}));

const step = (lengthCm: string, widthCm: string, heightCm: string, weightKg = "2") => ({
  packageType: "standard_package",
  weightKg,
  lengthCm,
  widthCm,
  heightCm,
});

describe("MOVO-317: opciones y validación del paquete sin límites duros", () => {
  it("las opciones de medida van de 10 a 300 cm de a 10, y la última es 'Más de 300 cm'", () => {
    expect(DIMENSION_OPTION_LABELS).toHaveLength(31);
    expect(DIMENSION_OPTION_LABELS[0]).toBe("10 cm");
    expect(DIMENSION_OPTION_LABELS[1]).toBe("20 cm");
    expect(DIMENSION_OPTION_LABELS[29]).toBe("300 cm");
    expect(DIMENSION_OPTION_LABELS[30]).toBe("Más de 300 cm");
  });

  it("'Más de 300 cm' viaja como el tope (300) y marca el envío como oversized", () => {
    expect(dimensionToCm(OVERSIZED_DIMENSION)).toBe(300);
    expect(dimensionToCm("40")).toBe(40);
    expect(dimensionToCm("")).toBeNull();
    expect(hasOversizedDimension("40", OVERSIZED_DIMENSION, "10")).toBe(true);
    expect(hasOversizedDimension("300", "300", "300")).toBe(false);
  });

  it("formatPackageDimensions agrega el aviso solo si el envío es oversized", () => {
    const base = { lengthCm: 300, widthCm: 40, heightCm: 20 };
    expect(formatPackageDimensions(base)).toBe("300 × 40 × 20 cm");
    expect(formatPackageDimensions({ ...base, oversized: false })).toBe("300 × 40 × 20 cm");
    expect(formatPackageDimensions({ ...base, oversized: true })).toBe(`300 × 40 × 20 cm · ${OVERSIZED_DIMENSION_LABEL}`);
  });

  it("el paso es válido con cualquier peso y medida, sin máximos", () => {
    expect(isPackageStepValid(step("300", "300", "300", "250"))).toBe(true);
    expect(isPackageStepValid(step(OVERSIZED_DIMENSION, "10", "10", "0.5"))).toBe(true);
    expect(isPackageStepValid(step(OVERSIZED_DIMENSION, OVERSIZED_DIMENSION, OVERSIZED_DIMENSION, "1000"))).toBe(true);
  });

  it("los valores fijos de la carta siguen siendo válidos", () => {
    expect(isPackageStepValid({ ...step("30", "21", "1", "0.1"), packageType: "letter_document" })).toBe(true);
  });

  it("peso vacío, 0 o negativo, o una medida sin elegir, no dejan avanzar", () => {
    expect(isPackageStepValid(step("10", "10", "10", ""))).toBe(false);
    expect(isPackageStepValid(step("10", "10", "10", "0"))).toBe(false);
    expect(isPackageStepValid(step("10", "10", "10", "-1"))).toBe(false);
    expect(isPackageStepValid(step("", "10", "10"))).toBe(false);
    expect(isPackageStepValid(step("10", "", "10"))).toBe(false);
    expect(isPackageStepValid(step("10", "10", ""))).toBe(false);
    expect(isPackageStepValid({ ...step("10", "10", "10"), packageType: null as never })).toBe(false);
  });
});

function ControlledWeight({ initial = "", onValue }: { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <WeightStepper
      testID="weight"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

describe("MOVO-317: WeightStepper (pasos de 0,5 kg y teclado)", () => {
  it("'+' desde vacío arranca en 0,5 y suma de a 0,5", async () => {
    const { getByTestId } = await render(<ControlledWeight />);

    await fireEvent.press(getByTestId("weight-plus"));
    expect(getByTestId("weight-input").props.value).toBe("0,5");
    await fireEvent.press(getByTestId("weight-plus"));
    expect(getByTestId("weight-input").props.value).toBe("1");
    await fireEvent.press(getByTestId("weight-plus"));
    expect(getByTestId("weight-input").props.value).toBe("1,5");
  });

  it("'−' resta de a 0,5 pero nunca baja de 0,5 kg", async () => {
    const { getByTestId } = await render(<ControlledWeight initial="1" />);

    await fireEvent.press(getByTestId("weight-minus"));
    expect(getByTestId("weight-input").props.value).toBe("0,5");
    await fireEvent.press(getByTestId("weight-minus"));
    expect(getByTestId("weight-input").props.value).toBe("0,5");
  });

  it("no tiene máximo: sigue sumando por encima de los antiguos 30 kg", async () => {
    const values: string[] = [];
    const { getByTestId } = await render(<ControlledWeight initial="30" onValue={(v) => values.push(v)} />);

    await fireEvent.press(getByTestId("weight-plus"));

    expect(values.at(-1)).toBe("30.5");
  });

  it.each([
    ["2,3", "2.5"],
    ["2.3", "2.5"],
    ["2,2", "2"],
    ["2,25", "2.5"],
    ["0,6", "0.5"],
    ["0,1", "0.5"],
    ["250", "250"],
    ["1000,7", "1000.5"],
  ])("al salir del campo, '%s' se redondea al múltiplo de 0,5 más cercano (%s)", async (typed, expected) => {
    const values: string[] = [];
    const { getByTestId } = await render(<ControlledWeight onValue={(v) => values.push(v)} />);

    await fireEvent.changeText(getByTestId("weight-input"), typed);
    await fireEvent(getByTestId("weight-input"), "blur");

    expect(values.at(-1)).toBe(expected);
  });

  it("acepta coma o punto: el campo muestra el valor redondeado con coma", async () => {
    const { getByTestId } = await render(<ControlledWeight />);

    await fireEvent.changeText(getByTestId("weight-input"), "3.3");
    await fireEvent(getByTestId("weight-input"), "blur");

    expect(getByTestId("weight-input").props.value).toBe("3,5");
  });

  it.each(["", "0", "0,0", "-2", "abc"])("'%s' no es válido: vacía el valor y muestra el error", async (typed) => {
    const values: string[] = [];
    const { getByTestId, getByText } = await render(<ControlledWeight initial="2" onValue={(v) => values.push(v)} />);

    await fireEvent.changeText(getByTestId("weight-input"), typed);
    await fireEvent(getByTestId("weight-input"), "blur");

    expect(values.at(-1)).toBe("");
    expect(getByTestId("weight-error")).toBeTruthy();
    expect(getByText("Ingresá un peso mayor a 0.")).toBeTruthy();
  });

  it("el error se va al volver a un valor válido", async () => {
    const { getByTestId, queryByTestId } = await render(<ControlledWeight initial="2" />);

    await fireEvent.changeText(getByTestId("weight-input"), "0");
    await fireEvent(getByTestId("weight-input"), "blur");
    expect(getByTestId("weight-error")).toBeTruthy();

    await fireEvent.press(getByTestId("weight-plus"));
    expect(queryByTestId("weight-error")).toBeNull();
    expect(getByTestId("weight-input").props.value).toBe("0,5");
  });
});

function ControlledDimensions({ onValues }: { onValues: (values: [string, string, string]) => void }) {
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  onValues([length, width, height]);
  return (
    <DimensionInputs
      testID="dims"
      lengthCm={length}
      widthCm={width}
      heightCm={height}
      onChangeLength={setLength}
      onChangeWidth={setWidth}
      onChangeHeight={setHeight}
    />
  );
}

describe("MOVO-317: DimensionInputs (desplegables de 10 a 300 cm y 'Más de 300 cm')", () => {
  it("elegir una medida la guarda como número y la muestra en el campo", async () => {
    const seen: [string, string, string][] = [];
    const { getByTestId, getByText } = await render(<ControlledDimensions onValues={(v) => seen.push(v)} />);

    await fireEvent.press(getByTestId("dims-length"));
    await fireEvent.press(getByTestId("dims-length-option-40 cm"));

    expect(seen.at(-1)).toEqual(["40", "", ""]);
    expect(getByText("40 cm")).toBeTruthy();
  });

  it("ofrece desde 10 cm hasta 300 cm y, al final, 'Más de 300 cm'", async () => {
    const { getByTestId } = await render(<ControlledDimensions onValues={() => undefined} />);

    await fireEvent.press(getByTestId("dims-width"));

    expect(getByTestId("dims-width-option-10 cm")).toBeTruthy();
    expect(getByTestId("dims-width-option-20 cm")).toBeTruthy();
  });

  it("con 'Más de 300 cm' elegida, el campo cerrado muestra '+300 cm'", async () => {
    const { getByText } = await render(
      <DimensionInputs
        testID="dims"
        lengthCm="10"
        widthCm="20"
        heightCm={OVERSIZED_DIMENSION}
        onChangeLength={() => undefined}
        onChangeWidth={() => undefined}
        onChangeHeight={() => undefined}
      />,
    );

    expect(getByText("+300 cm")).toBeTruthy();
  });

  it("'300 cm' y 'Más de 300 cm' son valores distintos del wizard", () => {
    expect(dimensionValueFromLabel("300 cm")).toBe("300");
    expect(dimensionValueFromLabel(OVERSIZED_DIMENSION_LABEL)).toBe(OVERSIZED_DIMENSION);
    expect(hasOversizedDimension("300", "300", "300")).toBe(false);
    expect(hasOversizedDimension(dimensionValueFromLabel(OVERSIZED_DIMENSION_LABEL), "10", "10")).toBe(true);
  });
});

describe("MOVO-317: PackageStep", () => {
  beforeEach(() => {
    useShipmentWizardStore.getState().resetWizard();
  });

  it("al elegir Estándar el peso arranca cargado en 0,5 kg", async () => {
    const { getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);

    await fireEvent.press(getByTestId("package-step-category-standard_package"));

    expect(useShipmentWizardStore.getState().weightKg).toBe("0.5");
    expect(getByTestId("package-step-weight-input").props.value).toBe("0,5");
  });

  it("al pasar de Documento a otro tipo se limpian los valores fijos de la carta", async () => {
    const { getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);

    await fireEvent.press(getByTestId("package-step-category-letter_document"));
    expect(useShipmentWizardStore.getState()).toMatchObject({ weightKg: "0.1", lengthCm: "30", widthCm: "21", heightCm: "1" });

    await fireEvent.press(getByTestId("package-step-category-standard_package"));
    expect(useShipmentWizardStore.getState()).toMatchObject({ weightKg: "0.5", lengthCm: "", widthCm: "", heightCm: "" });
  });

  it("cambiar entre Estándar y Frágil conserva el peso y las medidas elegidas", async () => {
    const { getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);

    await fireEvent.press(getByTestId("package-step-category-standard_package"));
    await act(async () => {
      useShipmentWizardStore.getState().setWeightKg("7");
      useShipmentWizardStore.getState().setLengthCm("40");
    });
    await fireEvent.press(getByTestId("package-step-category-fragile_item"));

    expect(useShipmentWizardStore.getState()).toMatchObject({ weightKg: "7", lengthCm: "40" });
  });
});
