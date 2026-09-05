import { render } from "@testing-library/react-native";
import type { RecentRatingComment } from "@movo/shared/dist/types/user-profile";
import { ReputationCommentCard } from "../components/profile/reputation-comment-card";

function comment(overrides: Partial<RecentRatingComment> = {}): RecentRatingComment {
  return {
    id: "r1",
    raterId: "u2",
    score: 5,
    comment: "Todo perfecto",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ReputationCommentCard", () => {
  it("cae a 'Un usuario de Movo' cuando raterName no vino (MOVO-170, sin backend todavía)", async () => {
    const { getByText } = await render(<ReputationCommentCard comment={comment()} />);
    expect(getByText("Un usuario de Movo")).toBeTruthy();
  });

  it("muestra el nombre real cuando raterName vino", async () => {
    const { getByText } = await render(<ReputationCommentCard comment={comment({ raterName: "Lucas D." })} />);
    expect(getByText("Lucas D.")).toBeTruthy();
  });

  it("trunca a 3 líneas en variant carousel, sin límite en variant list", async () => {
    const { getByText } = await render(
      <ReputationCommentCard comment={comment({ comment: "Un comentario largo" })} variant="list" />,
    );
    expect(getByText("Un comentario largo").props.numberOfLines).toBeUndefined();
  });

  it("no rompe si el comentario es null (solo estrellas)", async () => {
    const { queryByText } = await render(<ReputationCommentCard comment={comment({ comment: null })} />);
    expect(queryByText("Todo perfecto")).toBeNull();
  });
});
