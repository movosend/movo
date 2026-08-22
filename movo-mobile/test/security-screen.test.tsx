import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import AccountSecurityScreen from "../app/(app)/profile/security";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

/** MOVO-136 AC1: el hub de "Cuenta y seguridad" es una pantalla real, no el
 * `Alert.alert("Próximamente")` que tenía el ítem de Perfil. */
describe("AccountSecurityScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("navega a la pantalla de cambio de contraseña", async () => {
    const { getByTestId } = await render(<AccountSecurityScreen />);

    await fireEvent.press(getByTestId("security-change-password"));

    expect(router.push).toHaveBeenCalledWith("/profile/change-password");
  });

  it("navega a la baja de cuenta", async () => {
    const { getByTestId } = await render(<AccountSecurityScreen />);

    await fireEvent.press(getByTestId("security-delete-account"));

    expect(router.push).toHaveBeenCalledWith("/profile/delete-account");
  });

  it("vuelve atrás desde el header", async () => {
    const { getByTestId } = await render(<AccountSecurityScreen />);

    await fireEvent.press(getByTestId("security-back"));

    expect(router.back).toHaveBeenCalled();
  });
});
