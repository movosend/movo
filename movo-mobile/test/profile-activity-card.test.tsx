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
          asSender: breakdown({ reputationScore: null, ratingCount: 0, isNewProfile: true }),
          recentRatingComments: [],
        }}
      />,
    );

    expect(queryByTestId("card-role-carrier")).toBeNull();
    expect(getByText("4.9")).toBeTruthy();
  });

  it("un transportista que nunca envió pero tiene reseñas como receptor ve la pestaña \"Como emisor\"", async () => {
    const { getByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 0, asCarrier: 4 }}
        reputationScore={4.5}
        reputation={{
          asCarrier: breakdown({ reputationScore: 4.9 }),
          asSender: breakdown({ reputationScore: 4.0, ratingCount: 1 }),
          recentRatingComments: [],
        }}
      />,
    );

    expect(getByTestId("card-role-sender")).toBeTruthy();
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
  // MOVO-168: la reputación es una segunda query; carga y falla dentro de la card.
  it("MOVO-168: mientras la reputación carga muestra su skeleton, sin tocar 'Tu actividad'", async () => {
    const { getByText, getByTestId, queryByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 2, asCarrier: 0 }}
        reputationScore={4.5}
        reputationLoading
      />,
    );

    expect(getByText("Tu actividad")).toBeTruthy();
    expect(getByTestId("card-reputation-skeleton")).toBeTruthy();
    expect(queryByTestId("card-reputation")).toBeNull();
  });

  it("MOVO-168: si la reputación falla muestra el error con Reintentar local", async () => {
    const onRetry = jest.fn();
    const { getByText, getByTestId, queryByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 2, asCarrier: 0 }}
        reputationScore={4.5}
        reputationError
        onRetryReputation={onRetry}
      />,
    );

    expect(getByText("Tu actividad")).toBeTruthy();
    expect(queryByTestId("card-reputation-skeleton")).toBeNull();
    await act(async () => fireEvent.press(getByTestId("card-reputation-error-retry")));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("MOVO-168: con la reputación ya resuelta, ni skeleton ni error aunque un refetch falle", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 2, asCarrier: 0 }}
        reputationScore={4.8}
        reputationError
        reputation={{ asSender: breakdown(), asCarrier: breakdown(), recentRatingComments: [comment()] }}
      />,
    );

    expect(getByTestId("card-reputation")).toBeTruthy();
    expect(queryByTestId("card-reputation-error")).toBeNull();
    expect(queryByTestId("card-reputation-skeleton")).toBeNull();
  });
  it("cada pestaña muestra solo las reseñas recibidas en ese rol (feedback de TestFlight, build 17)", async () => {
    const asCarrier = comment({ id: "c1", comment: "Se frenó a tomar un café" });
    const { getByTestId, queryByText, getByText } = await render(
      <ProfileActivityCard
        testID="card"
        transactionCounts={{ asSender: 1, asCarrier: 1 }}
        reputationScore={3}
        reputation={{
          asCarrier: breakdown(),
          asSender: breakdown(),
          recentRatingComments: [asCarrier],
          recentRatingCommentsByRole: { asCarrier: [asCarrier], asSender: [] },
        }}
      />,
    );

    expect(getByText("Se frenó a tomar un café")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("card-role-sender"));
    });
    expect(queryByText("Se frenó a tomar un café")).toBeNull();
  });

  // MOVO-354
  describe("rediseño de la card de reputación (MOVO-354)", () => {
    const manyComments = (n: number) =>
      Array.from({ length: n }, (_, i) => comment({ id: `r${i + 1}`, comment: `Comentario ${i + 1}` }));
    const renderCard = (n: number, extra: Partial<React.ComponentProps<typeof ProfileActivityCard>> = {}, ratingCount = n) =>
      render(
        <ProfileActivityCard
          testID="card"
          transactionCounts={{ asSender: 3, asCarrier: 0 }}
          reputationScore={4.7}
          reputation={{
            asCarrier: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
            asSender: breakdown({ reputationScore: 4.7, ratingCount }),
            recentRatingComments: manyComments(n),
          }}
          onViewAllRatings={jest.fn()}
          {...extra}
        />,
      );

    it("muestra como máximo las 3 reseñas más recientes", async () => {
      const { getByText, queryByText } = await renderCard(5);
      expect(getByText("Comentario 3")).toBeTruthy();
      expect(queryByText("Comentario 4")).toBeNull();
      expect(queryByText("Comentario 5")).toBeNull();
    });

    it("'Ver todas' aparece con más de 3 reseñas y no con 3 o menos", async () => {
      expect((await renderCard(4)).queryByTestId("card-view-all")).not.toBeNull();
      expect((await renderCard(3)).queryByTestId("card-view-all")).toBeNull();
      expect((await renderCard(1)).queryByTestId("card-view-all")).toBeNull();
    });

    it("'Ver todas' también aparece si el conteo real supera 3 aunque la lista cargada traiga menos", async () => {
      expect((await renderCard(2, {}, 12)).queryByTestId("card-view-all")).not.toBeNull();
    });

    it("'Ver todas' llama al callback sin pasar un rol (abre todas las reseñas)", async () => {
      const onViewAllRatings = jest.fn();
      const { getByTestId } = await renderCard(5, { onViewAllRatings });
      await act(async () => {
        fireEvent.press(getByTestId("card-view-all"));
      });
      expect(onViewAllRatings).toHaveBeenCalledTimes(1);
      expect(onViewAllRatings).toHaveBeenCalledWith();
    });

    it("las pestañas se llaman 'Como Transportista' y 'Como Emisor o Receptor'", async () => {
      const { getByText } = await render(
        <ProfileActivityCard
          testID="card"
          transactionCounts={{ asSender: 2, asCarrier: 2 }}
          reputationScore={4.7}
          reputation={{ asCarrier: breakdown(), asSender: breakdown(), recentRatingComments: [comment()] }}
        />,
      );
      expect(getByText("Como Transportista")).toBeTruthy();
      expect(getByText("Como Emisor o Receptor")).toBeTruthy();
    });

    it("el rol de quien calificó se ve en la pestaña de transportista y no en la de emisor o receptor", async () => {
      const carrierSide = comment({ id: "c1", raterRole: "sender" });
      const senderSide = comment({ id: "s1", raterRole: "carrier" });
      const { getByTestId, queryByTestId } = await render(
        <ProfileActivityCard
          testID="card"
          transactionCounts={{ asSender: 2, asCarrier: 2 }}
          reputationScore={4.7}
          reputation={{
            asCarrier: breakdown(),
            asSender: breakdown(),
            recentRatingComments: [carrierSide, senderSide],
            recentRatingCommentsByRole: { asCarrier: [carrierSide], asSender: [senderSide] },
          }}
        />,
      );
      expect(getByTestId("card-comment-c1-role")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("card-role-sender"));
      });
      expect(queryByTestId("card-comment-s1-role")).toBeNull();
    });

    it("una pestaña sin calificaciones de un perfil que no es nuevo no muestra 'Perfil nuevo'", async () => {
      const { queryByTestId, getByTestId } = await render(
        <ProfileActivityCard
          testID="card"
          transactionCounts={{ asSender: 2, asCarrier: 2 }}
          reputationScore={4.7}
          isNewProfile={false}
          reputation={{
            asCarrier: breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 0 }),
            asSender: breakdown(),
            recentRatingComments: [comment()],
            recentRatingCommentsByRole: { asCarrier: [], asSender: [comment()] },
          }}
        />,
      );
      expect(queryByTestId("card-new-badge")).toBeNull();
      expect(getByTestId("card-comments-empty")).toBeTruthy();
    });
  });
});
