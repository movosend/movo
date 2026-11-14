import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import ProfileRatingsScreen from "../app/(app)/profile/ratings";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const mockUsePublicProfile = jest.fn();
const mockUseUserRatings = jest.fn();

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => mockUsePublicProfile(),
  useUserRatings: (...args: unknown[]) => mockUseUserRatings(...args),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { userId: string } }) => unknown) =>
    selector({ user: { userId: "user-1" } }),
}));

// "Ver todas" de la card de reputación del perfil propio (MOVO-154, rediseño
// post-feedback) — reusa la misma query de `usePublicProfile`, ya cacheada.
describe("ProfileRatingsScreen", () => {
  beforeEach(() => {
    mockUseUserRatings.mockReturnValue({ data: undefined, hasNextPage: false });
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockParams = {};
  });

  const profileWith = (comments: unknown[]) => ({
    isLoading: false,
    data: {
      id: "user-1",
      reputationScore: 4.5,
      ratingCount: 9,
      isNewProfile: false,
      asSender: { reputationScore: 3.2, ratingCount: 4, isNewProfile: false },
      asCarrier: { reputationScore: 4.9, ratingCount: 5, isNewProfile: false },
      recentRatingComments: comments,
    },
  });
  const rating = (id: string, name: string, raterRole: string | null, comment: string | null = "Todo bien") => ({
    id,
    raterId: `u-${id}`,
    raterName: name,
    raterRole,
    score: 5,
    comment,
    createdAt: "2026-10-26T00:00:00.000Z",
  });

  it("muestra todas las reseñas de cualquier rol, sin filtrar, con el puntaje y el conteo globales (MOVO-354)", async () => {
    mockParams = { role: "sender" }; // aunque llegue un ?role= viejo, se ignora
    mockUsePublicProfile.mockReturnValue(
      profileWith([rating("c1", "Pedro", "sender"), rating("s1", "Ana", "carrier")]),
    );

    const { getByTestId, getByText } = await render(<ProfileRatingsScreen />);

    expect(getByTestId("profile-ratings-comment-c1")).toBeTruthy();
    expect(getByTestId("profile-ratings-comment-s1")).toBeTruthy();
    expect(getByText("4.5")).toBeTruthy();
    expect(getByText(/9 calificaciones en total/)).toBeTruthy();
    expect(mockUseUserRatings).toHaveBeenCalledWith("user-1");
  });

  it("muestra el rol de quien calificó salvo cuando es transportista", async () => {
    mockUsePublicProfile.mockReturnValue(
      profileWith([rating("c1", "Pedro", "sender"), rating("c2", "Ale", "receiver"), rating("s1", "Ana", "carrier")]),
    );

    const { getByTestId, queryByTestId } = await render(<ProfileRatingsScreen />);

    expect(getByTestId("profile-ratings-comment-c1-role")).toBeTruthy();
    expect(getByTestId("profile-ratings-comment-c2-role")).toBeTruthy();
    expect(queryByTestId("profile-ratings-comment-s1-role")).toBeNull();
  });

  it("el buscador filtra por nombre sin importar tildes ni mayúsculas, y avisa si nada coincide", async () => {
    mockUsePublicProfile.mockReturnValue(
      profileWith([rating("c1", "Tomás Vergara", "sender"), rating("c2", "Alena Ariza", "receiver")]),
    );

    const { getByTestId, queryByTestId, getByText } = await render(<ProfileRatingsScreen />);
    await fireEvent.changeText(getByTestId("profile-ratings-search"), "TOMAS");
    expect(getByTestId("profile-ratings-comment-c1")).toBeTruthy();
    expect(queryByTestId("profile-ratings-comment-c2")).toBeNull();

    await fireEvent.changeText(getByTestId("profile-ratings-search"), "zzz");
    expect(getByText(/Ninguna calificación coincide con "zzz"/)).toBeTruthy();

    await fireEvent.press(getByTestId("profile-ratings-search-clear"));
    expect(getByTestId("profile-ratings-comment-c2")).toBeTruthy();
  });

  it("mientras hay una búsqueda trae las páginas que faltan y oculta 'Cargar más'", async () => {
    const fetchNextPage = jest.fn();
    mockUsePublicProfile.mockReturnValue(profileWith([]));
    mockUseUserRatings.mockReturnValue({
      data: { pages: [{ items: [rating("a1", "Ana", "sender")], nextCursor: "c" }] },
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage,
    });

    const { getByTestId, queryByTestId } = await render(<ProfileRatingsScreen />);
    expect(queryByTestId("profile-ratings-more")).not.toBeNull();
    expect(fetchNextPage).not.toHaveBeenCalled();

    await fireEvent.changeText(getByTestId("profile-ratings-search"), "an");
    expect(fetchNextPage).toHaveBeenCalled();
    expect(queryByTestId("profile-ratings-more")).toBeNull();
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
  it("pagina con GET /users/:id/ratings y 'Cargar más' pide la página siguiente", async () => {
    const fetchNextPage = jest.fn();
    const older = { id: "s9", raterId: "u9", raterName: "Ana", score: 4, comment: "Vieja", createdAt: "2026-01-02T00:00:00.000Z" };
    mockUsePublicProfile.mockReturnValue(profileWith([]));
    mockUseUserRatings.mockReturnValue({ data: { pages: [{ items: [older], nextCursor: "c" }] }, hasNextPage: true, isFetchingNextPage: false, fetchNextPage });

    const { getByTestId } = await render(<ProfileRatingsScreen />);

    expect(mockUseUserRatings).toHaveBeenCalledWith("user-1");
    expect(getByTestId("profile-ratings-comment-s9")).toBeTruthy();
    await fireEvent.press(getByTestId("profile-ratings-more"));
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
