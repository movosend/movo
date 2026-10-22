import { fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { router } from "expo-router";
import { SuspendedScreenGate } from "../components/account/suspended-screen-gate";

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));

const mockUseActiveSuspension = jest.fn();
jest.mock("../src/hooks/use-account-restriction", () => ({
  useActiveSuspension: () => mockUseActiveSuspension(),
}));

// MOVO-300 AC2: un formulario que inicia algo nuevo no se muestra con la cuenta suspendida.
describe("SuspendedScreenGate", () => {
  afterEach(() => jest.clearAllMocks());

  it("sin suspensión muestra el formulario", async () => {
    mockUseActiveSuspension.mockReturnValue(null);

    const { getByText, queryByTestId } = await render(
      <SuspendedScreenGate testID="gate" action="declareTrip">
        <Text>Formulario</Text>
      </SuspendedScreenGate>,
    );

    expect(getByText("Formulario")).toBeTruthy();
    expect(queryByTestId("gate")).toBeNull();
  });

  it("con la cuenta suspendida lo reemplaza por la explicación y lleva al detalle", async () => {
    mockUseActiveSuspension.mockReturnValue({
      type: "suspension",
      reason: "Fraude",
      endsAt: "2026-10-26T02:00:00.000Z",
    });

    const { getByTestId, getByText, queryByText } = await render(
      <SuspendedScreenGate testID="gate" action="declareTrip">
        <Text>Formulario</Text>
      </SuspendedScreenGate>,
    );

    expect(queryByText("Formulario")).toBeNull();
    expect(
      getByText(
        "No podés declarar viajes mientras tu cuenta esté suspendida (hasta el 25/10).",
      ),
    ).toBeTruthy();
    fireEvent.press(getByTestId("gate-cta"));
    expect(router.replace).toHaveBeenCalledWith("/account-status");
  });
});
