import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import { router } from "expo-router";
import ProfilePhotoScreen from "../app/(auth)/profile-photo";
import { SECURE_STORE_KEYS, secureStore } from "../src/lib/secure-store";
import { useAuthStore } from "../src/store/auth-store";

jest.mock("expo-router", () => ({
  router: {
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  },
}));

const mockResetRegistration = jest.fn();
let mockKycStatus = "approved" as KycStatus;
let mockFields = {
  firstName: "Tomas",
  lastName: "Olmos",
};

jest.mock("../src/hooks/use-registration", () => ({
  useRegistration: () => ({
    fields: mockFields,
    resetRegistration: mockResetRegistration,
    kycStatus: mockKycStatus,
  }),
}));

jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => ({
    data: null,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

describe("ProfilePhotoScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      status: "unauthenticated",
      accessToken: null,
      refreshToken: null,
      user: null,
    });
  });

  it("muestra el texto explicativo de por qué importa la foto en Movo", async () => {
    const { getByText, getByTestId } = await render(<ProfilePhotoScreen />);

    expect(getByText(/Tu foto de perfil/i)).toBeTruthy();
    expect(
      getByText(/permite que la contraparte te reconozca en el punto de encuentro/i),
    ).toBeTruthy();
    expect(getByTestId("onboarding-photo-picker")).toBeTruthy();
    expect(getByTestId("profile-photo-continue-btn")).toBeTruthy();
    expect(getByTestId("profile-photo-skip-btn")).toBeTruthy();
  });

  it("permite saltar con 'Más tarde', limpia el registro pendiente y va a /home", async () => {
    jest.spyOn(secureStore, "getItem").mockImplementation(async (key: string) => {
      if (key === SECURE_STORE_KEYS.pendingRegistrationRefreshToken) return "mock-refresh-tok";
      if (key === SECURE_STORE_KEYS.pendingRegistrationAccessToken) return "mock-access-tok";
      if (key === SECURE_STORE_KEYS.pendingRegistrationUserId) return "u-123";
      return null;
    });

    const { getByTestId } = await render(<ProfilePhotoScreen />);

    await fireEvent.press(getByTestId("profile-photo-skip-btn"));

    await waitFor(() => {
      expect(mockResetRegistration).toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith("/home");
    });
  });

  it("al continuar con foto, limpia el registro pendiente y navega a /home", async () => {
    useAuthStore.setState({
      status: "authenticated",
      accessToken: "token",
      refreshToken: "refresh",
      user: {
        userId: "u-123",
        fullName: "Tomas Olmos",
        roles: [UserRole.SENDER],
        kycStatus: KycStatus.APPROVED,
      },
    });

    const { getByTestId } = await render(<ProfilePhotoScreen />);

    await fireEvent.press(getByTestId("profile-photo-continue-btn"));

    await waitFor(() => {
      expect(mockResetRegistration).toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith("/home");
    });
  });
});
