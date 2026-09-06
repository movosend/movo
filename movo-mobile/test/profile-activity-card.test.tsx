import { act, fireEvent, render, within } from "@testing-library/react-native";
import type { ReputationBreakdown, RecentRatingComment } from "@movo/shared/dist/types/user-profile";
import { ProfileActivityCard } from "../components/profile/profile-activity-card";

function breakdown(overrides: Partial<ReputationBreakdown> = {}): ReputationBreakdown {
  return { reputationScore: 4.8, ratingCount: 12, isNewProfile: false, ...overrides };
}

function comment(overrides: Partial<RecentRatingComment> = {}): RecentRatingComment {
  return {
    id: "r1",
    raterId: "u2",
    raterName: "Un usuario de Movo",
    score: 5,
    comment: "Todo perfecto",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

// MOVO-154 (rediseño post-feedback): antes eran dos bloques separados
// (`ProfileStatsRow` + `ReputationDetail`) — ahora una sola card.
describe("ProfileActivityCard", () => {
  it("muestra siempre 'Tu actividad', con o sin reputación resuelta", async () => {
    const { getByText, queryByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 0, asCarrier: 0 }}
        reputationScore={null}
      />,
    );

    expect(getByText("Tu actividad")).toBeTruthy();
    expect(queryByTestId("card-reputation")).toBeNull();
  });

  it("no muestra el toggle de rol si solo hay transacciones en uno", async () => {
    const { queryByTestId, getByText } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 0, asCarrier: 4 }}
        reputationScore={5.0}
        reputation={{
          asCarrier: breakdown({ reputationScore: 4.9 }),
          asSender: breakdown({ reputationScore: null, isNewProfile: true }),
          recentRatingComments: [],
        }}
      />,
    );

    expect(queryByTestId("card-role-carrier")).toBeNull();
    expect(getByText("4.9")).toBeTruthy();
  });

  it("muestra el toggle y cambia de rol al tocarlo cuando hay ambos", async () => {
    const { getByTestId, getByText } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 3, asCarrier: 4 }}
        reputationScore={4.5}
        reputation={{
          asCarrier: breakdown({ reputationScore: 4.9 }),
          asSender: breakdown({ reputationScore: 4.2 }),
          recentRatingComments: [],
        }}
      />,
    );

    expect(getByText("4.9")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("card-role-sender"));
    });
    expect(getByText("4.2")).toBeTruthy();
  });

  // Feedback: "si el perfil es nuevo y no hay comentarios, toda esta sección es
  // irrelevante" — se oculta entera (ni badge, ni nota, ni caja de "sin
  // calificaciones") en vez del estado vacío que mostraba antes.
  it("perfil nuevo sin comentarios: no muestra la sección de reputación en absoluto", async () => {
    const { queryByTestId, queryByText } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 1, asCarrier: 0 }}
        reputationScore={null}
        isNewProfile
        reputation={{
          asCarrier: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
          asSender: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
          recentRatingComments: [],
        }}
      />,
    );

    expect(queryByTestId("card-reputation")).toBeNull();
    expect(queryByText("Tu reputación")).toBeNull();
  });

  // Caso borde: menos de 3 calificaciones (`isNewProfile`) pero ya hay algún
  // comentario real — sí hay algo genuino para mostrar, así que la sección se
  // mantiene (badge en vez del score gigante, sin las estrellas vacías).
  it("perfil nuevo con al menos un comentario: muestra la sección con el badge, sin estrellas vacías", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 1, asCarrier: 0 }}
        reputationScore={null}
        isNewProfile
        reputation={{
          asCarrier: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
          asSender: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 1 }),
          recentRatingComments: [comment()],
        }}
      />,
    );

    expect(within(getByTestId("card-new-badge")).getByText("Perfil nuevo")).toBeTruthy();
    expect(queryByTestId("card-stars")).toBeNull();
  });

  it("con reputación real pero sin comentarios todavía, muestra el estado vacío explícito (no oculta la sección)", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 3, asCarrier: 0 }}
        reputationScore={4.7}
        reputation={{
          asCarrier: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
          asSender: breakdown({ reputationScore: 4.7 }),
          recentRatingComments: [],
        }}
      />,
    );

    expect(getByTestId("card-comments-empty")).toBeTruthy();
    expect(queryByTestId("card-comments-carousel")).toBeNull();
    expect(queryByTestId("card-view-all")).toBeNull();
  });

  it("muestra el carrusel de comentarios y el link 'Ver todas' cuando hay al menos uno", async () => {
    const onViewAllRatings = jest.fn();
    const { getByTestId, getByText } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 3, asCarrier: 0 }}
        reputationScore={4.7}
        reputation={{
          asCarrier: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
          asSender: breakdown({ reputationScore: 4.7 }),
          recentRatingComments: [comment(), comment({ id: "r2", comment: "Excelente" })],
        }}
        onViewAllRatings={onViewAllRatings}
      />,
    );

    expect(getByTestId("card-comments-carousel")).toBeTruthy();
    expect(getByText("Todo perfecto")).toBeTruthy();
    expect(getByText("Excelente")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("card-view-all"));
    });
    expect(onViewAllRatings).toHaveBeenCalled();
  });

  it("no muestra 'Ver todas' si no vino el callback, aunque haya comentarios", async () => {
    const { queryByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 3, asCarrier: 0 }}
        reputationScore={4.7}
        reputation={{
          asCarrier: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
          asSender: breakdown({ reputationScore: 4.7 }),
          recentRatingComments: [comment()],
        }}
      />,
    );

    expect(queryByTestId("card-view-all")).toBeNull();
  });
});
