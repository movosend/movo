import { act, fireEvent, render } from "@testing-library/react-native";
import LoginScreen from "../app/(auth)/login";

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: (...args: unknown[]) => mockPush(...args), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("../src/api/auth-client", () => ({
  authClient: { login: jest.fn() },
}));

jest.mock("../src/hooks/use-registration", () => {
  const actual = jest.requireActual("../src/hooks/use-registration");
  return {
    ...actual,
    useRegistration: () => ({ hydrateFromLogin: jest.fn() }),
  };
});

async function press(el: unknown) {
  await act(async () => {
    fireEvent.press(el as never);
    await Promise.resolve();
  });
}

describe("LoginScreen (MOVO-141: link de recuperación de contraseña)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
  });

  it("el link '¿Olvidaste tu contraseña?' navega a /forgot-password", async () => {
    const screen = await render(<LoginScreen />);
    await press(screen.getByTestId("login-forgot-password"));

    expect(mockPush).toHaveBeenCalledWith("/forgot-password");
  });

  it("sin el param passwordReset no muestra ningún aviso de éxito", async () => {
    const screen = await render(<LoginScreen />);
    expect(screen.queryByTestId("login-reset-success-banner")).toBeNull();
  });

  it("con passwordReset=1 muestra el aviso de contraseña actualizada", async () => {
    mockParams = { passwordReset: "1" };
    const screen = await render(<LoginScreen />);

    expect(screen.getByTestId("login-reset-success-banner")).toBeTruthy();
    expect(screen.getByText(/Contraseña actualizada/)).toBeTruthy();
  });
});
