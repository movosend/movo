import { render } from "@testing-library/react-native";
import App from "../App";

describe("App", () => {
  it("renderiza la pantalla de dev tokens", async () => {
    const { getByText } = await render(<App />);
    expect(getByText("Preview de tokens")).toBeTruthy();
  });
});
