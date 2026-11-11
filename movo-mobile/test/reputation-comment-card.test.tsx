import { render } from "@testing-library/react-native";
import type { RecentRatingComment } from "@movo/shared/dist/types/user-profile";
import { ReputationCommentCard } from "../components/profile/reputation-comment-card";

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

describe("ReputationCommentCard", () => {
  it("muestra el label genérico que resuelve el backend para un calificador con cuenta borrada (MOVO-39)", async () => {
    const { getByText } = await render(<ReputationCommentCard comment={comment()} />);
    expect(getByText("Un usuario de Movo")).toBeTruthy();
  });

  it("muestra el nombre real cuando raterName vino", async () => {
    const { getByText } = await render(<ReputationCommentCard comment={comment({ raterName: "Lucas D." })} />);
    expect(getByText("Lucas D.")).toBeTruthy();
  });

  it("sin límite de líneas en variant list", async () => {
    const { getByText } = await render(
      <ReputationCommentCard comment={comment({ comment: "Un comentario largo" })} variant="list" />,
    );
    expect(getByText("Un comentario largo").props.numberOfLines).toBeUndefined();
  });

  it("no rompe si el comentario es null (solo estrellas)", async () => {
    const { queryByText } = await render(<ReputationCommentCard comment={comment({ comment: null })} />);
    expect(queryByText("Todo perfecto")).toBeNull();
  });

  it("con comentario muestra el texto; sin comentario, 'Sin comentario' (MOVO-354)", async () => {
    const withText = await render(<ReputationCommentCard comment={comment({ comment: "Muy bien" })} />);
    expect(withText.getByText("Muy bien")).toBeTruthy();
    expect(withText.queryByText("Sin comentario")).toBeNull();

    const without = await render(<ReputationCommentCard comment={comment({ comment: null })} />);
    expect(without.getByText("Sin comentario")).toBeTruthy();
  });

  it("muestra el rol de quien calificó con su etiqueta, y nada si no viene o se oculta", async () => {
    const sender = await render(<ReputationCommentCard comment={comment({ raterRole: "sender" })} />);
    expect(sender.getByText("Emisor")).toBeTruthy();

    const receiver = await render(<ReputationCommentCard comment={comment({ raterRole: "receiver" })} />);
    expect(receiver.getByText("Receptor")).toBeTruthy();

    const carrier = await render(<ReputationCommentCard comment={comment({ raterRole: "carrier" })} />);
    expect(carrier.getByText("Transportista")).toBeTruthy();

    const none = await render(<ReputationCommentCard testID="n" comment={comment({ raterRole: null })} />);
    expect(none.queryByTestId("n-role")).toBeNull();

    const hidden = await render(
      <ReputationCommentCard testID="h" comment={comment({ raterRole: "carrier" })} showRaterRole={false} />,
    );
    expect(hidden.queryByTestId("h-role")).toBeNull();
  });

  it("en el carrusel trunca el comentario a 4 líneas", async () => {
    const { getByTestId } = await render(
      <ReputationCommentCard testID="c" comment={comment({ comment: "Largo" })} variant="carousel" />,
    );
    expect(getByTestId("c-text").props.numberOfLines).toBe(4);
  });
});
