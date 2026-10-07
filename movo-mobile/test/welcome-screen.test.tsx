import { act, render } from "@testing-library/react-native";
import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import WelcomeScreen from "../app/index";
import { useAuthStore } from "../src/store/auth-store";
import { useBootStore } from "../src/store/boot-store";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

let mockRegistration = {
  resumeChecked: true,
  hasPendingRegistration: false,
  kycStatus: null as KycStatus | null,
  hydrateFromLogin: jest.fn(),
};
jest.mock("../src/hooks/use-registration", () => {
  const actual = jest.requireActual("../src/hooks/use-registration");
  return {
    ...actual,
    useRegistration: () => mockRegistration,
  };
});

jest.mock("../src/api/users-client", () => ({
  usersClient: { getMyProfile: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usersClient } = require("../src/api/users-client");

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * MOVO-247: `app/index.tsx` es ahora quien le avisa al splash animado
 * (`useBootStore`) que ya terminó de resolver a dónde navegar en el arranque.
 * Estos tests cubren esa señal, no el contenido visual de la pantalla (ya
 * cubierto implícitamente por los tests de `welcome-go-register`/etc. de otros
 * paquetes de esta US).
 */
describe("WelcomeScreen -- boot resuelto (MOVO-247)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistration = {
      resumeChecked: true,
      hasPendingRegistration: false,
      kycStatus: null,
      hydrateFromLogin: jest.fn(),
    };
    useAuthStore.setState({ status: "unauthenticated", accessToken: null, refreshToken: null, user: null });
    useBootStore.setState({ initialRouteResolved: false });
  });

  it("sin sesión y sin registro pendiente: se queda en Bienvenida y marca resuelto", async () => {
    await render(<WelcomeScreen />);
    await flush();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(useBootStore.getState().initialRouteResolved).toBe(true);
  });

  it("mientras la sesión todavía está \"checking\": NO marca resuelto (evita el push visible)", async () => {
    useAuthStore.setState({ status: "checking", accessToken: null, refreshToken: null, user: null });
    await render(<WelcomeScreen />);
    await flush();

    expect(useBootStore.getState().initialRouteResolved).toBe(false);

    // Al resolverse la sesión (sin usuario -> unauthenticated), recién ahí marca.
    await act(async () => {
      useAuthStore.setState({ status: "unauthenticated" });
    });
    await flush();
    expect(useBootStore.getState().initialRouteResolved).toBe(true);
  });

  it("sesión autenticada con KYC aprobado: navega a /home y marca resuelto", async () => {
    useAuthStore.setState({
      status: "authenticated",
      accessToken: "t",
      refreshToken: "r",
      user: { userId: "u1", fullName: "Ana", roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED },
    });
    await render(<WelcomeScreen />);
    await flush();

    expect(mockReplace).toHaveBeenCalledWith("/home");
    expect(useBootStore.getState().initialRouteResolved).toBe(true);
  });

  it("sesión autenticada sin KYC aprobado: hidrata el registro, navega a /kyc y marca resuelto", async () => {
    usersClient.getMyProfile.mockRejectedValue(new Error("network"));
    useAuthStore.setState({
      status: "authenticated",
      accessToken: "t",
      refreshToken: "r",
      user: { userId: "u1", fullName: "Ana", roles: [UserRole.SENDER], kycStatus: KycStatus.PENDING },
    });
    await render(<WelcomeScreen />);
    await flush();
    await flush();

    expect(mockRegistration.hydrateFromLogin).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/kyc");
    expect(useBootStore.getState().initialRouteResolved).toBe(true);
  });

  it("registro pendiente sin empezar (NOT_STARTED): auto-redirige a /kyc y marca resuelto", async () => {
    mockRegistration = {
      resumeChecked: true,
      hasPendingRegistration: true,
      kycStatus: KycStatus.NOT_STARTED,
      hydrateFromLogin: jest.fn(),
    };
    await render(<WelcomeScreen />);
    await flush();

    expect(mockReplace).toHaveBeenCalledWith("/kyc");
    expect(useBootStore.getState().initialRouteResolved).toBe(true);
  });

  it("mientras `resumeChecked` sigue en `false`, no marca resuelto todavía", async () => {
    mockRegistration = { ...mockRegistration, resumeChecked: false };
    await render(<WelcomeScreen />);
    await flush();

    expect(useBootStore.getState().initialRouteResolved).toBe(false);
  });
});
