import { act, fireEvent, render } from "@testing-library/react-native";
import { PackagePresets } from "../components/send/package-presets";
import { isPackageStepValid, PackageStep } from "../components/send/steps/package-step";
import { DIMENSION_OPTION_LABELS, dimensionLabel } from "../src/lib/package-dimensions";
import {
  PACKAGE_PRESETS,
  matchingPackagePreset,
  presetDimensionsLabel,
} from "../src/lib/package-presets";
import { useShipmentWizardStore } from "../src/store/shipment-wizard-store";

jest.mock("../src/hooks/use-theme-colors", () => ({
  useThemeColors: () => ({ fg1: "#111111", fg2: "#555555", fg3: "#888888" }),
}));

const SMALL = PACKAGE_PRESETS[0];
const MEDIUM = PACKAGE_PRESETS[1];
const LARGE = PACKAGE_PRESETS[2];

describe("MOVO-317: tamaños rápidos (valores)", () => {
  it("hay tres: pequeño, mediano y grande, en ese orden", () => {
    expect(PACKAGE_PRESETS.map((p) => p.id)).toEqual(["small", "medium", "large"]);
    expect(PACKAGE_PRESETS.map((p) => p.label)).toEqual(["Pequeño", "Mediano", "Grande"]);
  });

  it("cada tamaño es más grande y pesado que el anterior", () => {
    const volume = (p: (typeof PACKAGE_PRESETS)[number]) => Number(p.lengthCm) * Number(p.widthCm) * Number(p.heightCm);
    expect(volume(SMALL)).toBeLessThan(volume(MEDIUM));
    expect(volume(MEDIUM)).toBeLessThan(volume(LARGE));
    expect(Number(SMALL.weightKg)).toBeLessThan(Number(MEDIUM.weightKg));
    expect(Number(MEDIUM.weightKg)).toBeLessThan(Number(LARGE.weightKg));
  });

  it("las medidas son opciones reales del desplegable y el peso un múltiplo de 0,5 kg", () => {
    for (const preset of PACKAGE_PRESETS) {
      for (const cm of [preset.lengthCm, preset.widthCm, preset.heightCm]) {
        expect(DIMENSION_OPTION_LABELS).toContain(dimensionLabel(cm));
      }
      expect(Number(preset.weightKg) % 0.5).toBe(0);
      expect(Number(preset.weightKg)).toBeGreaterThanOrEqual(0.5);
    }
  });

  it.each(PACKAGE_PRESETS.map((p) => [p.label, p] as const))("'%s' deja el paso válido", (_label, preset) => {
    expect(
      isPackageStepValid({
        packageType: "standard_package",
        weightKg: preset.weightKg,
        lengthCm: preset.lengthCm,
        widthCm: preset.widthCm,
        heightCm: preset.heightCm,
      }),
    ).toBe(true);
  });

  it("matchingPackagePreset reconoce los cuatro valores y nada más", () => {
    expect(matchingPackagePreset(MEDIUM)?.id).toBe("medium");
    expect(matchingPackagePreset({ ...MEDIUM, weightKg: "8.0" })?.id).toBe("medium");
    expect(matchingPackagePreset({ ...MEDIUM, weightKg: "9" })).toBeNull();
    expect(matchingPackagePreset({ ...MEDIUM, heightCm: "40" })).toBeNull();
    expect(matchingPackagePreset({ weightKg: "", lengthCm: "", widthCm: "", heightCm: "" })).toBeNull();
  });

  it("presetDimensionsLabel arma el texto de las medidas", () => {
    expect(presetDimensionsLabel(SMALL)).toBe("30 × 20 × 20 cm");
    expect(presetDimensionsLabel(LARGE)).toBe("100 × 60 × 60 cm");
  });
});

describe("MOVO-317: PackagePresets (componente)", () => {
  const empty = { weightKg: "", lengthCm: "", widthCm: "", heightCm: "" };

  it("muestra los tres botones con sus medidas y peso", async () => {
    const { getByText } = await render(<PackagePresets {...empty} onSelect={() => undefined} testID="presets" />);

    expect(getByText("Pequeño")).toBeTruthy();
    expect(getByText("30 × 20 × 20 cm")).toBeTruthy();
    expect(getByText("2 kg")).toBeTruthy();
    expect(getByText("Mediano")).toBeTruthy();
    expect(getByText("50 × 40 × 30 cm")).toBeTruthy();
    expect(getByText("8 kg")).toBeTruthy();
    expect(getByText("Grande")).toBeTruthy();
    expect(getByText("100 × 60 × 60 cm")).toBeTruthy();
    expect(getByText("25 kg")).toBeTruthy();
  });

  it.each(PACKAGE_PRESETS.map((p) => [p.id, p] as const))("tocar '%s' avisa con ese preset", async (id, preset) => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(<PackagePresets {...empty} onSelect={onSelect} testID="presets" />);

    await fireEvent.press(getByTestId(`presets-${id}`));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(preset);
  });

  it("marca como seleccionado solo el que coincide con los valores actuales", async () => {
    const { getByTestId, rerender } = await render(<PackagePresets {...MEDIUM} onSelect={() => undefined} testID="presets" />);

    // El seleccionado se pinta con el fondo de contraste (`bg-fg`), el resto con `bg-bg`.
    expect(getByTestId("presets-medium").props.className).toContain("bg-fg");
    expect(getByTestId("presets-small").props.className).toContain("bg-bg");
    expect(getByTestId("presets-large").props.className).toContain("bg-bg");

    await rerender(<PackagePresets {...MEDIUM} weightKg="9" onSelect={() => undefined} testID="presets" />);
    for (const id of ["small", "medium", "large"]) {
      expect(getByTestId(`presets-${id}`).props.className).toContain("bg-bg");
    }
  });
});

describe("MOVO-317: tamaños rápidos en el paso del paquete", () => {
  beforeEach(() => {
    useShipmentWizardStore.getState().resetWizard();
  });

  it("no aparecen hasta elegir un tipo, y tampoco con Documento", async () => {
    const { queryByTestId, getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);
    expect(queryByTestId("package-step-presets")).toBeNull();

    await fireEvent.press(getByTestId("package-step-category-letter_document"));
    expect(queryByTestId("package-step-presets")).toBeNull();

    await fireEvent.press(getByTestId("package-step-category-standard_package"));
    expect(queryByTestId("package-step-presets")).toBeTruthy();
  });

  it.each(PACKAGE_PRESETS.map((p) => [p.label, p] as const))(
    "tocar '%s' carga peso y las tres medidas en el wizard",
    async (_label, preset) => {
      const { getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);
      await fireEvent.press(getByTestId("package-step-category-standard_package"));

      await fireEvent.press(getByTestId(`package-step-presets-${preset.id}`));

      expect(useShipmentWizardStore.getState()).toMatchObject({
        weightKg: preset.weightKg,
        lengthCm: preset.lengthCm,
        widthCm: preset.widthCm,
        heightCm: preset.heightCm,
      });
    },
  );

  it("el campo de peso y los desplegables muestran lo cargado", async () => {
    const { getByTestId, getAllByText } = await render(<PackageStep onFocusInput={() => undefined} />);
    await fireEvent.press(getByTestId("package-step-category-fragile_item"));

    await fireEvent.press(getByTestId("package-step-presets-large"));

    expect(getByTestId("package-step-weight-input").props.value).toBe("25");
    // Largo 100 cm; Ancho y Alto 60 cm (la lista de opciones del desplegable está cerrada).
    expect(getAllByText("100 cm")).toHaveLength(1);
    expect(getAllByText("60 cm")).toHaveLength(2);
  });

  it("con un tamaño cargado el paso queda válido", async () => {
    const { getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);
    await fireEvent.press(getByTestId("package-step-category-standard_package"));
    expect(isPackageStepValid(useShipmentWizardStore.getState())).toBe(false);

    await fireEvent.press(getByTestId("package-step-presets-small"));

    expect(isPackageStepValid(useShipmentWizardStore.getState())).toBe(true);
  });

  it("ajustar un valor a mano desmarca el tamaño; volver a tocarlo lo restaura", async () => {
    const { getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);
    await fireEvent.press(getByTestId("package-step-category-standard_package"));
    await fireEvent.press(getByTestId("package-step-presets-medium"));
    expect(getByTestId("package-step-presets-medium").props.className).toContain("bg-fg");

    await act(async () => {
      useShipmentWizardStore.getState().setHeightCm("40");
    });
    expect(getByTestId("package-step-presets-medium").props.className).toContain("bg-bg");

    await fireEvent.press(getByTestId("package-step-presets-medium"));
    expect(getByTestId("package-step-presets-medium").props.className).toContain("bg-fg");
    expect(useShipmentWizardStore.getState().heightCm).toBe("30");
  });

  it("cambiar entre tamaños reemplaza todos los valores", async () => {
    const { getByTestId } = await render(<PackageStep onFocusInput={() => undefined} />);
    await fireEvent.press(getByTestId("package-step-category-standard_package"));

    await fireEvent.press(getByTestId("package-step-presets-large"));
    await fireEvent.press(getByTestId("package-step-presets-small"));

    expect(useShipmentWizardStore.getState()).toMatchObject({
      weightKg: "2",
      lengthCm: "30",
      widthCm: "20",
      heightCm: "20",
    });
  });
});
