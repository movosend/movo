import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import { ProfileSettingsSection } from "../components/profile/profile-settings-section";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

// MOVO-121: "Direcciones guardadas" es el primer ítem de esta sección con pantalla
// real — cubre que navega en vez de mostrar el `Alert.alert` placeholder, y que el
// resto de los 5 ítems (fuera de alcance del ticket) sigue mostrándolo.
describe("ProfileSettingsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("navega a /addresses al tocar 'Direcciones guardadas'", async () => {
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Direcciones guardadas"));

    expect(router.push).toHaveBeenCalledWith("/addresses");
  });

  it("sigue mostrando el placeholder 'Próximamente' para el resto de los ítems", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByText } = await render(<ProfileSettingsSection testID="settings" />);

    fireEvent.press(getByText("Notificaciones"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Próximamente",
      "Estamos trabajando en esta sección.",
    );
    alertSpy.mockRestore();
  });
});
