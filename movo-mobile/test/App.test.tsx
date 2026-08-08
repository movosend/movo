import { render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import WelcomeScreen from "../app/index";
import { RegistrationProvider } from "../src/hooks/use-registration";
import { authClient } from "../src/api/auth-client";
import * as secureStore from "../src/lib/secure-store";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/api/auth-client", () => ({
  authClient: {
    register: jest.fn(),
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    geocodeAddress: jest.fn(),
    createKycSession: jest.fn(),
    getKycStatus: jest.fn(),
  },
}));

async function renderWelcome() {
  return await render(
    <RegistrationProvider>
      <WelcomeScreen />
    </RegistrationProvider>,
  );
}

describe("WelcomeScreen", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra el hero y los dos caminos de entrada cuando no hay registro pendiente", async () => {
    const { getByText, getByTestId } = await renderWelcome();
    await waitFor(() => expect(getByText(/La red logística pensada/)).toBeTruthy());
    expect(getByTestId("welcome-go-register")).toBeTruthy();
    expect(getByTestId("welcome-go-login")).toBeTruthy();
  });

  it("redirige a /kyc si ya hay un registro pendiente (AC7, resume tras un cierre a mitad de KYC)", async () => {
    jest.spyOn(secureStore.secureStore, "getItem").mockImplementation(async (key: string) => {
      if (key === "movo.pendingRegistrationUserId") return "usr_1";
      if (key === "movo.pendingRegistrationAccessToken") return "access_1";
      return null;
    });
    (authClient.getKycStatus as jest.Mock).mockResolvedValue({
      status: "not_started",
      manualReviewReason: null,
    });
    const replaceSpy = jest.spyOn(router, "replace");

    await renderWelcome();

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/kyc"));
  });

  it("no vuelve a redirigir a /kyc si el KYC ya se intentó (evita el loop de 'Ir al inicio')", async () => {
    jest.spyOn(secureStore.secureStore, "getItem").mockImplementation(async (key: string) => {
      if (key === "movo.pendingRegistrationUserId") return "usr_1";
      if (key === "movo.pendingRegistrationAccessToken") return "access_1";
      return null;
    });
    // "pending": ya se creó una sesión de Didit (aunque no se haya resuelto) — el
    // usuario ya interactuó con el KYC, así que "Ir al inicio" desde `kyc.tsx` tiene
    // que poder traerlo hasta acá sin que este efecto lo mande de vuelta.
    (authClient.getKycStatus as jest.Mock).mockResolvedValue({
      status: "pending",
      manualReviewReason: null,
    });
    const replaceSpy = jest.spyOn(router, "replace");

    const { findByTestId } = await renderWelcome();

    expect(await findByTestId("welcome-continue-kyc")).toBeTruthy();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
