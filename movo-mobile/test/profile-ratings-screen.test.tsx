import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import ProfileRatingsScreen from "../app/(app)/profile/ratings";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
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
  afterEach(() => {
    jest.clearAllMocks();
    mockParams = {};
  });

  it("con ?role= muestra solo las reseñas de ese rol", async () => {
    mockParams = { role: "carrier" };
    const asCarrier = { id: "c1", raterId: "u2", raterName: "Pedro", score: 3, comment: "Café en la YPF", createdAt: "2026-10-26T00:00:00.000Z" };
    const asSender = { id: "s1", raterId: "u3", raterName: "Ana", score: 5, comment: "Todo bien", createdAt: "2026-10-20T00:00:00.000Z" };
    mockUsePublicProfile.mockReturnValue({
      isLoading: false,
      data: {
        id: "user-1",
        reputationScore: 4,
        ratingCount: 2,
        isNewProfile: true,
        recentRatingComments: [asCarrier, asSender],
        recentRatingCommentsByRole: { asCarrier: [asCarrier], asSender: [asSender] },
      },
    });

    const { getByTestId, queryByTestId } = await render(<ProfileRatingsScreen />);
    expect(getByTestId("profile-ratings-comment-c1")).toBeTruthy();
    expect(queryByTestId("profile-ratings-comment-s1")).toBeNull();
  });

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
