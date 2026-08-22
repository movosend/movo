import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import ChangePasswordScreen from "../app/(app)/profile/change-password";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));

const mockMutate = jest.fn();
let mockIsPending = false;
jest.mock("../src/hooks/use-account-security", () => ({
  useChangePassword: () => ({ mutate: mockMutate, isPending: mockIsPending }),
}));

/** El wiring real de `mutate` → `setSession` vive en `use-account-security.test.tsx`
 * (AC2); acá se cubre la pantalla: validación de cliente, errores y confirmación. */
async function fillValidForm(getByTestId: (id: string) => unknown) {
  await fireEvent.changeText(getByTestId("change-password-current") as never, "Password1");
  await fireEvent.changeText(getByTestId("change-password-new") as never, "Password2");
  await fireEvent.changeText(getByTestId("change-password-confirm") as never, "Password2");
}

describe("ChangePasswordScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPending = false;
  });

  // AC4
  it("no habilita el envío si la contraseña nueva no cumple la política", async () => {
    const { getByTestId } = await render(<ChangePasswordScreen />);

    await fireEvent.changeText(getByTestId("change-password-current"), "Password1");
    await fireEvent.changeText(getByTestId("change-password-new"), "corta1");
    await fireEvent.changeText(getByTestId("change-password-confirm"), "corta1");
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  // AC4
  it("no habilita el envío si 'repetir contraseña' no coincide", async () => {
    const { getByTestId } = await render(<ChangePasswordScreen />);

    await fireEvent.changeText(getByTestId("change-password-current"), "Password1");
    await fireEvent.changeText(getByTestId("change-password-new"), "Password2");
    await fireEvent.changeText(getByTestId("change-password-confirm"), "Password3");
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  // AC4: el backend lo rechaza con un 400 genérico — mejor atajarlo con un mensaje claro.
  it("no deja reusar la contraseña actual como nueva", async () => {
    const { getByTestId, getByText } = await render(<ChangePasswordScreen />);

    await fireEvent.changeText(getByTestId("change-password-current"), "Password1");
    await fireEvent.changeText(getByTestId("change-password-new"), "Password1");
    await fireEvent.changeText(getByTestId("change-password-confirm"), "Password1");
    await fireEvent(getByTestId("change-password-new"), "blur");
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(getByText("Elegí una contraseña distinta de la actual.")).toBeTruthy();
  });

  it("envía las dos contraseñas cuando el formulario es válido", async () => {
    const { getByTestId } = await render(<ChangePasswordScreen />);

    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(mockMutate).toHaveBeenCalledWith(
      { currentPassword: "Password1", newPassword: "Password2" },
      expect.anything(),
    );
  });

  // AC2
  it("muestra la confirmación y avisa del cierre de sesión en otros dispositivos", async () => {
    mockMutate.mockImplementation((_body, { onSuccess }) => onSuccess());
    const { getByTestId, getByText } = await render(<ChangePasswordScreen />);

    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(getByTestId("change-password-success")).toBeTruthy();
    expect(getByText("Contraseña actualizada")).toBeTruthy();
    expect(getByText(/Cerramos la sesión en tus otros dispositivos/)).toBeTruthy();

    await fireEvent.press(getByTestId("change-password-done"));
    expect(router.back).toHaveBeenCalled();
  });

  // AC3: el 401 se ancla al campo de contraseña actual, no cierra la sesión ni se
  // confunde con "tu sesión venció" (el interceptor de http-client solo refresca ante
  // AUTH_TOKEN_EXPIRED, así que este código llega intacto hasta acá).
  it("muestra 'La contraseña actual no es correcta' ante un 401, sin salir de la pantalla", async () => {
    mockMutate.mockImplementation((_body, { onError }) =>
      onError(new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.")),
    );
    const { getByTestId, getByText, queryByTestId } = await render(<ChangePasswordScreen />);

    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(getByText("La contraseña actual no es correcta.")).toBeTruthy();
    expect(queryByTestId("change-password-success")).toBeNull();
    expect(getByTestId("change-password-content")).toBeTruthy();
  });

  it("limpia el error de contraseña actual apenas el usuario la corrige", async () => {
    mockMutate.mockImplementation((_body, { onError }) =>
      onError(new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.")),
    );
    const { getByTestId, queryByText } = await render(<ChangePasswordScreen />);

    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("change-password-submit"));
    expect(queryByText("La contraseña actual no es correcta.")).toBeTruthy();

    await fireEvent.changeText(getByTestId("change-password-current"), "Password9");

    expect(queryByText("La contraseña actual no es correcta.")).toBeNull();
  });

  // AC7: lo que no pertenece a ningún campo va al banner compartido del perfil.
  it("muestra el rate limit del backend en el banner, con copy propio de esta pantalla", async () => {
    mockMutate.mockImplementation((_body, { onError }) =>
      onError(new ApiError(429, "RATE_LIMIT_EXCEEDED", "Demasiados intentos.")),
    );
    const { getByTestId, getByText } = await render(<ChangePasswordScreen />);

    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(getByTestId("change-password-error")).toBeTruthy();
    expect(getByText(/demasiados intentos de cambio de contraseña/i)).toBeTruthy();
  });

  // AC7: la falla de red trae su propio mensaje desde http-client.ts.
  it("muestra el mensaje de conexión ante una falla de red", async () => {
    mockMutate.mockImplementation((_body, { onError }) =>
      onError(new ApiError(0, "INTERNAL_ERROR", "No se pudo conectar con el servidor. Revisá tu conexión.")),
    );
    const { getByTestId, getByText } = await render(<ChangePasswordScreen />);

    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("change-password-submit"));

    expect(getByText(/No se pudo conectar con el servidor/)).toBeTruthy();
  });

  it("revela la contraseña actual sin revelar la nueva (un toggle por campo)", async () => {
    const { getByTestId } = await render(<ChangePasswordScreen />);

    expect(getByTestId("change-password-current").props.secureTextEntry).toBe(true);
    await fireEvent.press(getByTestId("change-password-current-toggle"));

    expect(getByTestId("change-password-current").props.secureTextEntry).toBe(false);
    expect(getByTestId("change-password-new").props.secureTextEntry).toBe(true);
  });
});
