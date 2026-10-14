import { render } from "@testing-library/react-native";
import { DimensionInputs } from "../components/send/dimension-inputs";
import { isPackageStepValid } from "../components/send/steps/package-step";

jest.mock("../src/hooks/use-theme-colors", () => ({
  useThemeColors: () => ({ fg3: "#888888" }),
}));

const step = (lengthCm: string, widthCm: string, heightCm: string, weightKg = "2") => ({
  packageType: "standard_package",
  weightKg,
  lengthCm,
  widthCm,
  heightCm,
});

describe("MOVO-276: límites duros del paquete en el wizard", () => {
  it("acepta un paquete con la suma de lados justo en 300 cm", () => {
    expect(isPackageStepValid(step("150", "100", "50"))).toBe(true);
  });

  it("rechaza lados válidos que suman más de 300 cm", () => {
    expect(isPackageStepValid(step("150", "100", "51"))).toBe(false);
  });

  it("muestra el hint de suma de lados solo cuando cada medida está en rango", async () => {
    const noop = () => undefined;
    const props = {
      onChangeLength: noop,
      onChangeWidth: noop,
      onChangeHeight: noop,
      onFocusInput: noop,
      testID: "dims",
    };

    const over = await render(<DimensionInputs {...props} lengthCm="150" widthCm="100" heightCm="60" />);
    expect(over.getByTestId("dims-sum-error")).toBeTruthy();
    expect(over.getByText(/ahora suman 310 cm/)).toBeTruthy();

    const sideOut = await render(<DimensionInputs {...props} lengthCm="160" widthCm="100" heightCm="60" />);
    expect(sideOut.getByTestId("dims-error")).toBeTruthy();
    expect(sideOut.queryByTestId("dims-sum-error")).toBeNull();

    const ok = await render(<DimensionInputs {...props} lengthCm="40" widthCm="30" heightCm="30" />);
    expect(ok.queryByTestId("dims-sum-error")).toBeNull();
  });
});
