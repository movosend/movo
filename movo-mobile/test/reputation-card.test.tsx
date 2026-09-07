import { fireEvent, render } from "@testing-library/react-native";
import type { ReputationBreakdown } from "@movo/shared/dist/types/user-profile";
import { ReputationCard } from "../components/profile/reputation-card";

function breakdown(overrides: Partial<ReputationBreakdown> = {}): ReputationBreakdown {
  return { reputationScore: 4.8, ratingCount: 12, isNewProfile: false, ...overrides };
}

describe("ReputationCard", () => {
  it("no muestra el toggle si la persona solo tiene un rol con transacciones", async () => {
    const { queryByTestId, getByText } = await render(
      <ReputationCard
        testID="rep"
        hasCarrier
        hasSender={false}
        role="carrier"
        onRoleChange={jest.fn()}
        asCarrier={breakdown({ reputationScore: 4.9 })}
        asSender={breakdown({ reputationScore: null, isNewProfile: true })}
      />
    );

    expect(queryByTestId("rep-role-carrier")).toBeNull();
    expect(getByText("4.9")).toBeTruthy();
  });

  it("muestra el toggle y cambia de rol al tocarlo", async () => {
    const onRoleChange = jest.fn();
    const { getByTestId, getByText } = await render(
      <ReputationCard
        testID="rep"
        hasCarrier
        hasSender
        role="carrier"
        onRoleChange={onRoleChange}
        asCarrier={breakdown({ reputationScore: 4.9 })}
        asSender={breakdown({ reputationScore: 4.2 })}
      />
    );

    expect(getByText("4.9")).toBeTruthy();
    await fireEvent.press(getByTestId("rep-role-sender"));
    expect(onRoleChange).toHaveBeenCalledWith("sender");
  });

  it("muestra 'Perfil nuevo' para el rol activo cuando corresponde", async () => {
    const { getByText } = await render(
      <ReputationCard
        testID="rep"
        hasCarrier
        hasSender
        role="sender"
        onRoleChange={jest.fn()}
        asCarrier={breakdown({ reputationScore: 4.9 })}
        asSender={breakdown({ reputationScore: null, isNewProfile: true, ratingCount: 1 })}
      />
    );

    expect(getByText("Perfil nuevo")).toBeTruthy();
  });

  it("no muestra barras de categoría cuando no vienen (MOVO-173, todavía sin backend)", async () => {
    const { queryByText } = await render(
      <ReputationCard
        testID="rep"
        hasCarrier
        hasSender={false}
        role="carrier"
        onRoleChange={jest.fn()}
        asCarrier={breakdown()}
        asSender={breakdown()}
      />
    );

    expect(queryByText("Puntualidad")).toBeNull();
  });

  it("muestra barras de categoría cuando vienen en el breakdown", async () => {
    const { getByText } = await render(
      <ReputationCard
        testID="rep"
        hasCarrier
        hasSender={false}
        role="carrier"
        onRoleChange={jest.fn()}
        asCarrier={breakdown({
          categories: [
            { key: "punctuality", label: "Puntualidad", score: 4.9 },
            { key: "care", label: "Cuidado", score: 5.0 },
          ],
        })}
        asSender={breakdown()}
      />
    );

    expect(getByText("Puntualidad")).toBeTruthy();
    expect(getByText("Cuidado")).toBeTruthy();
  });
});
