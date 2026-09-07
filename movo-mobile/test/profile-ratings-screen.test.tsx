import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import ProfileRatingsScreen from "../app/(app)/profile/ratings";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));

const mockUsePublicProfile = jest.fn();

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => mockUsePublicProfile(),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { userId: string } }) => unknown) =>
    selector({ user: { userId: "user-1" } }),
}));

// "Ver todas" de la card de reputación del perfil propio (MOVO-154, rediseño
// post-feedback) — reusa la misma query de `usePublicProfile`, ya cacheada.
describe("ProfileRatingsScreen", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra el skeleton mientras carga", async () => {
    mockUsePublicProfile.mockReturnValue({ isLoading: true, data: undefined });

    const { getByTestId } = await render(<ProfileRatingsScreen />);
    expect(getByTestId("profile-ratings-skeleton")).toBeTruthy();
  });

  it("muestra el estado vacío sin comentarios", async () => {
    mockUsePublicProfile.mockReturnValue({
      isLoading: false,
      data: {
        id: "user-1",
        fullName: "Martina Zurita",
        photoUrl: null,
        isVerified: true,
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
        ratingCount: 0,
        isNewProfile: true,
        asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
        asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true },
        recentRatingComments: [],
      },
    });

    const { getByTestId } = await render(<ProfileRatingsScreen />);
    expect(getByTestId("profile-ratings-empty")).toBeTruthy();
  });

  it("muestra todos los comentarios completos, sin truncar", async () => {
    mockUsePublicProfile.mockReturnValue({
      isLoading: false,
      data: {
        id: "user-1",
        fullName: "Martina Zurita",
        photoUrl: null,
        isVerified: true,
        badges: [],
        transactionCounts: { asSender: 3, asCarrier: 0 },
        reputationScore: 4.8,
        ratingCount: 2,
        isNewProfile: false,
        asSender: { reputationScore: 4.8, ratingCount: 2, isNewProfile: false },
        asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true },
        recentRatingComments: [
          { id: "r1", raterId: "u2", score: 5, comment: "Comentario uno", createdAt: "2026-08-01T00:00:00.000Z" },
          { id: "r2", raterId: "u3", score: 4, comment: "Comentario dos", createdAt: "2026-07-01T00:00:00.000Z" },
        ],
      },
    });

    const { getByText, getByTestId } = await render(<ProfileRatingsScreen />);
    expect(getByText("Comentario uno")).toBeTruthy();
    expect(getByText("Comentario dos")).toBeTruthy();

    fireEvent(getByTestId("profile-ratings-back"), "touchEnd");
    expect(router.back).toHaveBeenCalled();
  });
});
