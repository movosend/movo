import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import TransportScreen from "../app/(app)/(tabs)/transport";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

describe("TransportScreen", () => {
  it("navega a 'Mis viajes' al tocar el CTA (MOVO-162)", async () => {
    const { getByTestId } = await render(<TransportScreen />);

    fireEvent.press(getByTestId("transport-my-trips-cta"));

    expect(router.push).toHaveBeenCalledWith("/carrier/trips");
  });
});
