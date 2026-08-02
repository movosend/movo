import { render } from "@testing-library/react-native";
import WelcomeScreen from "../app/index";

describe("WelcomeScreen", () => {
  it("muestra el hero y los dos caminos de entrada", async () => {
    const { getByText, getByTestId } = await render(<WelcomeScreen />);
    expect(getByText(/La red logística pensada/)).toBeTruthy();
    expect(getByTestId("welcome-go-register")).toBeTruthy();
    expect(getByTestId("welcome-go-login")).toBeTruthy();
  });
});
