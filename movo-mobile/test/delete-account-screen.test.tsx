import { ApiError } from "@movo/shared/dist/errors/api-error";
import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import DeleteAccountScreen from "../app/(app)/profile/delete-account";

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
  useDeleteAccount: () => ({ mutate: mockMutate, isPending: mockIsPending }),
}));

/**
 * MOVO-136 AC5/AC6. El wiring real de `mutate` → `clearSession()` + `queryClient.clear()`
 * vive en `use-account-security.test.ts`; acá se cubre la pantalla: las barreras
 * previas al borrado, la confirmación nativa y el manejo de los errores del backend.
 */

/** Deja el formulario en el único estado desde el que el botón dispara algo. */
async function armForm(getByTestId: (id: string) => never) {
  await fireEvent.press(getByTestId("delete-account-acknowledge"));
  await fireEvent.changeText(getByTestId("delete-account-password"), "Password1");
}

/**
 * Ejecuta el botón destructivo del `Alert.alert` que la pantalla acaba de disparar.
 * Va dentro de `act()` porque el callback del diálogo nativo no pasa por ningún
 * evento de RNTL: sin eso, los `setState` del `onError` no se flushean antes del
 * `getByText` que sigue.
 */
async function confirmAlert() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as
    | { text: string; style?: string; onPress?: () => void }[]
    | undefined;
  const destructive = buttons?.find((b) => b.style === "destructive");
  await act(async () => {
    destructive?.onPress?.();
  });
}

describe("DeleteAccountScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPending = false;
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  // AC5: "no se puede disparar de un solo tap".
  it("no borra nada con solo tocar el botón: falta el reconocimiento y la contraseña", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen />);

    await fireEvent.press(getByTestId("delete-account-submit"));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // AC5
  it("no habilita el envío si falta la contraseña, aun con el reconocimiento marcado", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen />);

    await fireEvent.press(getByTestId("delete-account-acknowledge"));
    await fireEvent.press(getByTestId("delete-account-submit"));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // AC5
  it("no habilita el envío si falta el reconocimiento, aun con la contraseña escrita", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen />);

    await fireEvent.changeText(getByTestId("delete-account-password"), "Password1");
    await fireEvent.press(getByTestId("delete-account-submit"));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // AC5: el formulario armado tampoco borra directo — todavía falta confirmar.
  it("pide confirmación nativa antes de llamar al backend", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();

    await confirmAlert();
    expect(mockMutate).toHaveBeenCalledWith("Password1", expect.anything());
  });

  // AC5: cancelar en el diálogo no puede tener efecto.
  it("no llama al backend si el usuario cancela la confirmación", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));

    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.style === "cancel")?.onPress?.();

    expect(mockMutate).not.toHaveBeenCalled();
  });

  // AC5: la pantalla explica qué implica antes de pedir nada.
  it("explica que es irreversible y qué pasa con los datos y el historial", async () => {
    const { getByText } = await render(<DeleteAccountScreen />);

    expect(getByText(/Esto es irreversible/i)).toBeTruthy();
    expect(getByText(/no vamos a poder recuperar tu cuenta/i)).toBeTruthy();
    expect(getByText(/se conserva de forma anónima/i)).toBeTruthy();
  });

  // AC7 / mismo criterio que change-password: el 401 es un error de campo.
  it("ancla el 401 bajo el campo de contraseña, sin salir de la pantalla", async () => {
    mockMutate.mockImplementation((_password, { onError }) =>
      onError(new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.")),
    );
    const { getByTestId, getByText } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));
    await confirmAlert();

    expect(getByText("La contraseña no es correcta.")).toBeTruthy();
    expect(getByTestId("delete-account-content")).toBeTruthy();
  });

  it("limpia el error de contraseña apenas el usuario la corrige", async () => {
    mockMutate.mockImplementation((_password, { onError }) =>
      onError(new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.")),
    );
    const { getByTestId, queryByText } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));
    await confirmAlert();
    expect(queryByText("La contraseña no es correcta.")).toBeTruthy();

    await fireEvent.changeText(getByTestId("delete-account-password"), "Password9");

    expect(queryByText("La contraseña no es correcta.")).toBeNull();
  });

  // AC7: el 409 de envíos activos no es "reintentá", es "resolvé esto primero" — y la
  // pantalla ofrece el camino para hacerlo.
  it("ante envíos activos explica qué hacer y ofrece ir a la lista de envíos", async () => {
    mockMutate.mockImplementation((_password, { onError }) =>
      onError(new ApiError(409, "ACCOUNT_HAS_ACTIVE_SHIPMENTS", "Tenés envíos activos.")),
    );
    const { getByTestId, getByText } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));
    await confirmAlert();

    expect(getByText(/Tenés envíos en curso/i)).toBeTruthy();

    await fireEvent.press(getByTestId("delete-account-view-shipments"));
    expect(router.push).toHaveBeenCalledWith("/shipments");
  });

  // AC7: en una disputa el usuario no puede hacer nada, así que no se le ofrece un
  // atajo que no lo lleva a ningún lado.
  it("ante una disputa abierta muestra el bloqueo sin ofrecer 'Ver mis envíos'", async () => {
    mockMutate.mockImplementation((_password, { onError }) =>
      onError(new ApiError(409, "ACCOUNT_HAS_ACTIVE_DISPUTES", "Tenés una disputa activa.")),
    );
    const { getByTestId, getByText, queryByTestId } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));
    await confirmAlert();

    expect(getByText(/disputa abierta/i)).toBeTruthy();
    expect(queryByTestId("delete-account-view-shipments")).toBeNull();
  });

  // AC7: el lock por usuario del backend (doble tap, dos dispositivos).
  it("traduce el 409 de baja en curso a un mensaje entendible", async () => {
    mockMutate.mockImplementation((_password, { onError }) =>
      onError(new ApiError(409, "ACCOUNT_DELETION_IN_PROGRESS", "Ya hay una baja en curso.")),
    );
    const { getByTestId, getByText } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));
    await confirmAlert();

    expect(getByText(/Ya hay una baja en curso/i)).toBeTruthy();
  });

  // AC7: la falla de red trae su propio mensaje desde http-client.ts.
  it("muestra el mensaje de conexión ante una falla de red", async () => {
    mockMutate.mockImplementation((_password, { onError }) =>
      onError(
        new ApiError(0, "INTERNAL_ERROR", "No se pudo conectar con el servidor. Revisá tu conexión."),
      ),
    );
    const { getByTestId, getByText } = await render(<DeleteAccountScreen />);

    await armForm(getByTestId as never);
    await fireEvent.press(getByTestId("delete-account-submit"));
    await confirmAlert();

    expect(getByText(/No se pudo conectar con el servidor/)).toBeTruthy();
  });

  it("oculta la contraseña por defecto y la revela con el toggle", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen />);

    expect(getByTestId("delete-account-password").props.secureTextEntry).toBe(true);
    await fireEvent.press(getByTestId("delete-account-password-toggle"));

    expect(getByTestId("delete-account-password").props.secureTextEntry).toBe(false);
  });

  it("vuelve atrás desde el header", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen />);

    await fireEvent.press(getByTestId("delete-account-back"));

    expect(router.back).toHaveBeenCalled();
  });
});
