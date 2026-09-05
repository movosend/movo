import { render } from "@testing-library/react-native";
import type { ReputationBreakdown, RecentRatingComment } from "@movo/shared/dist/types/user-profile";
import { ReputationDetail } from "../components/profile/reputation-detail";

function breakdown(overrides: Partial<ReputationBreakdown> = {}): ReputationBreakdown {
  return { reputationScore: 4.8, ratingCount: 12, isNewProfile: false, ...overrides };
}

// MOVO-154: desglose de reputación por rol + últimas calificaciones.
describe("ReputationDetail", () => {
  it("muestra el score real y el n de calificaciones por rol (AC2/AC3)", async () => {
    const { getByText } = await render(
      <ReputationDetail
        asSender={breakdown({ reputationScore: 4.5, ratingCount: 8 })}
        asCarrier={breakdown({ reputationScore: 4.9, ratingCount: 30 })}
        recentRatingComments={[]}
      />
    );

    expect(getByText("Como emisor")).toBeTruthy();
    expect(getByText("Como transportista")).toBeTruthy();
    expect(getByText("4.5")).toBeTruthy();
    expect(getByText("(8 calificaciones)")).toBeTruthy();
    expect(getByText("4.9")).toBeTruthy();
    expect(getByText("(30 calificaciones)")).toBeTruthy();
  });

  it("muestra 'Perfil nuevo' en vez del número con menos de 3 transacciones calificadas (AC5)", async () => {
    const { getByText, queryByText } = await render(
      <ReputationDetail
        asSender={breakdown({ reputationScore: null, ratingCount: 1, isNewProfile: true })}
        asCarrier={breakdown({ reputationScore: 4.9, ratingCount: 30, isNewProfile: false })}
        recentRatingComments={[]}
      />
    );

    expect(getByText("Perfil nuevo")).toBeTruthy();
    expect(getByText("4.9")).toBeTruthy();
    // Sin `n` de calificaciones junto a "Perfil nuevo" — el conteo no es relevante ahí.
    expect(queryByText("(1 calificación)")).toBeNull();
  });

  it("muestra la línea explicativa del cálculo del score (AC8)", async () => {
    const { getByText } = await render(
      <ReputationDetail asSender={breakdown()} asCarrier={breakdown()} recentRatingComments={[]} />
    );

    expect(
      getByText(/Promedio ponderado: las calificaciones recientes pesan más/)
    ).toBeTruthy();
  });

  it("muestra el estado vacío cuando no hay comentarios (AC6)", async () => {
    const { getByText } = await render(
      <ReputationDetail asSender={breakdown()} asCarrier={breakdown()} recentRatingComments={[]} />
    );

    expect(getByText("Todavía no tiene comentarios.")).toBeTruthy();
  });

  it("lista hasta 10 comentarios recientes con nota y fecha (AC6)", async () => {
    const comments: RecentRatingComment[] = [
      { id: "r1", raterId: "u1", score: 5, comment: "Excelente experiencia", createdAt: "2026-08-20T10:00:00.000Z" },
      { id: "r2", raterId: "u2", score: 4, comment: null, createdAt: "2026-07-01T10:00:00.000Z" },
    ];

    const { getByText, queryByText } = await render(
      <ReputationDetail asSender={breakdown()} asCarrier={breakdown()} recentRatingComments={comments} />
    );

    expect(getByText("Excelente experiencia")).toBeTruthy();
    expect(getByText("20 de ago de 2026")).toBeTruthy();
    expect(getByText("1 de jul de 2026")).toBeTruthy();
    expect(queryByText("Todavía no tiene comentarios.")).toBeNull();
  });
});
