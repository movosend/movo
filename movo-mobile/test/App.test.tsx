import { render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import WelcomeScreen from "../app/index";
import { RegistrationProvider } from "../src/hooks/use-registration";
import { authClient } from "../src/api/auth-client";
import * as secureStore from "../src/lib/secure-store";
import { useAuthStore } from "../src/store/auth-store";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// MOVO-249: por default estos tests simulan un dispositivo que YA vio el carrusel de
// onboarding — son casos preexistentes de esta pantalla, no de ese gate nuevo (que
// tiene su propia suite, ver más abajo "gate de onboarding (MOVO-249)").
jest.mock("../src/lib/onboarding-storage", () => ({
  hasSeenOnboarding: jest.fn().mockResolvedValue(true),
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

const DEFAULT_AUTH_STATE = useAuthStore.getState();

describe("WelcomeScreen", () => {
  afterEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState(DEFAULT_AUTH_STATE);
  });

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

  it("con sesión restaurada y KYC aprobado, redirige directo a /home sin mostrar el hero (MOVO-76 AC7)", async () => {
    useAuthStore.setState({
      status: "authenticated",
      accessToken: "access_1",
      refreshToken: "refresh_1",
      user: {
        userId: "usr_1",
        fullName: "Julia Pérez",
        roles: [UserRole.SENDER],
        kycStatus: KycStatus.APPROVED,
      },
    });
    const replaceSpy = jest.spyOn(router, "replace");

    const { queryByText } = await renderWelcome();

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/home"));
    expect(queryByText(/La red logística pensada/)).toBeNull();
  });

  it("con sesión restaurada y KYC no aprobado, hidrata el registro y redirige a /kyc, no a /home (MOVO-76 AC7/AC11)", async () => {
    useAuthStore.setState({
      status: "authenticated",
      accessToken: "access_1",
      refreshToken: "refresh_1",
      user: {
        userId: "usr_1",
        fullName: "Julia Pérez",
        roles: [UserRole.SENDER],
        kycStatus: KycStatus.PENDING,
      },
    });
    const setItemSpy = jest.spyOn(secureStore.secureStore, "setItem");
    const replaceSpy = jest.spyOn(router, "replace");

    await renderWelcome();

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/kyc"));
    expect(replaceSpy).not.toHaveBeenCalledWith("/home");
    expect(setItemSpy).toHaveBeenCalledWith("movo.pendingRegistrationAccessToken", "access_1");
  });

  describe("gate de onboarding (MOVO-249)", () => {
    it("un dispositivo que nunca vio el carrusel es redirigido a /onboarding en vez de mostrar el hero", async () => {
      const { hasSeenOnboarding } = require("../src/lib/onboarding-storage");
      (hasSeenOnboarding as jest.Mock).mockResolvedValue(false);
      // `jest.clearAllMocks()` (afterEach) limpia llamadas pero no restaura
      // `mockImplementation` — sin este reset explícito, este test hereda el
      // `getItem` con registro-pendiente que dejó seteado un test anterior.
      jest.spyOn(secureStore.secureStore, "getItem").mockResolvedValue(null);
      // La sesión ya terminó de restaurarse sin usuario: mientras sigue en "checking"
      // la pantalla no manda al carrusel (podría haber una sesión guardada).
      useAuthStore.setState({ status: "unauthenticated" });
      const replaceSpy = jest.spyOn(router, "replace");

      const { queryByText } = await renderWelcome();

      await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/onboarding"));
      expect(queryByText(/La red logística pensada/)).toBeNull();
    });

    it("un dispositivo con un registro ya en curso no se manda a /onboarding aunque no lo haya visto", async () => {
      const { hasSeenOnboarding } = require("../src/lib/onboarding-storage");
      (hasSeenOnboarding as jest.Mock).mockResolvedValue(false);
      jest.spyOn(secureStore.secureStore, "getItem").mockImplementation(async (key: string) => {
        if (key === "movo.pendingRegistrationUserId") return "usr_1";
        if (key === "movo.pendingRegistrationAccessToken") return "access_1";
        return null;
      });
      (authClient.getKycStatus as jest.Mock).mockResolvedValue({
        status: "pending",
        manualReviewReason: null,
      });
      const replaceSpy = jest.spyOn(router, "replace");

      const { findByTestId } = await renderWelcome();

      expect(await findByTestId("welcome-continue-kyc")).toBeTruthy();
      expect(replaceSpy).not.toHaveBeenCalledWith("/onboarding");
    });

    it("con sesión autenticada no se muestra el onboarding aunque el flag diga que no se vio", async () => {
      const { hasSeenOnboarding } = require("../src/lib/onboarding-storage");
      (hasSeenOnboarding as jest.Mock).mockResolvedValue(false);
      useAuthStore.setState({
        status: "authenticated",
        accessToken: "access_1",
        refreshToken: "refresh_1",
        user: {
          userId: "usr_1",
          fullName: "Julia Pérez",
          roles: [UserRole.SENDER],
          kycStatus: KycStatus.APPROVED,
        },
      });
      const replaceSpy = jest.spyOn(router, "replace");

      await renderWelcome();

      await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/home"));
      expect(replaceSpy).not.toHaveBeenCalledWith("/onboarding");
    });
  });
});
