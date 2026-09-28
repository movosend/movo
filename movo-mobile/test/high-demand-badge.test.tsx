import { act, fireEvent, render } from "@testing-library/react-native";
import { HIGH_DEMAND_HELP_TEXT, HighDemandBadge } from "../components/shipments/high-demand-badge";

describe("HighDemandBadge", () => {
  it("muestra el texto del badge con la ayuda colapsada", async () => {
    const { getByText, queryByTestId } = await render(<HighDemandBadge testID="badge" />);

    expect(getByText("Alta demanda en tu zona")).toBeTruthy();
    expect(queryByTestId("badge-help")).toBeNull();
  });

  it("despliega y vuelve a ocultar la ayuda al tocarlo", async () => {
    const { getByTestId, queryByTestId } = await render(<HighDemandBadge testID="badge" />);

    await act(async () => {
      fireEvent.press(getByTestId("badge-toggle"));
    });
    expect(getByTestId("badge-help").props.children).toBe(HIGH_DEMAND_HELP_TEXT);

    await act(async () => {
      fireEvent.press(getByTestId("badge-toggle"));
    });
    expect(queryByTestId("badge-help")).toBeNull();
  });

  it("explica el recargo sin mostrar un porcentaje (ADR-025)", () => {
    expect(HIGH_DEMAND_HELP_TEXT).toBe(
      "Hay más envíos que transportistas en tu zona de retiro, por eso el precio sugerido es un poco más alto",
    );
    expect(HIGH_DEMAND_HELP_TEXT).not.toMatch(/%|\d/);
  });
});
