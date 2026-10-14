import { fireEvent, render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { IdCard } from "lucide-react-native";
import { CarrierRequirementGate } from "../components/carrier/carrier-requirement-gate";

describe("CarrierRequirementGate", () => {
  it("muestra título, explicación y dispara el CTA", async () => {
    const onPressCta = jest.fn();
    const { getByText, getByTestId } = await render(
      <CarrierRequirementGate
        testID="gate"
        icon={IdCard}
        title="¡Verificá tu licencia para transportar paquetes!"
        body="Explicación del requisito."
        ctaLabel="Verificar licencia"
        onPressCta={onPressCta}
      />,
    );

    expect(getByText("¡Verificá tu licencia para transportar paquetes!")).toBeTruthy();
    expect(getByText("Explicación del requisito.")).toBeTruthy();
    expect(getByText("Verificar licencia")).toBeTruthy();

    await fireEvent.press(getByTestId("gate-cta"));
    expect(onPressCta).toHaveBeenCalledTimes(1);
  });

  it("dispara el CTA aunque el dispositivo no tenga haptics", async () => {
    jest.spyOn(Haptics, "impactAsync").mockRejectedValueOnce(new Error("haptics no disponible"));
    const onPressCta = jest.fn();
    const { getByTestId } = await render(
      <CarrierRequirementGate
        testID="gate"
        icon={IdCard}
        title="Título"
        body="Cuerpo"
        ctaLabel="Seguir"
        onPressCta={onPressCta}
      />,
    );

    await fireEvent.press(getByTestId("gate-cta"));
    expect(onPressCta).toHaveBeenCalledTimes(1);
  });
});
