import { act, fireEvent, render } from "@testing-library/react-native";
import { PayAddCardModal } from "../components/payments/pay-add-card-modal";

let mockWizardProps: { onSaved: (c: unknown, i: { defaultFailed: boolean }) => void; onCancel: () => void } | null = null;
jest.mock("../components/payments/add-card-wizard", () => {
  const { Pressable } = require("react-native");
  return {
    AddCardWizard: (props: typeof mockWizardProps) => {
      mockWizardProps = props;
      return <Pressable testID="wizard-mock" />;
    },
  };
});

describe("PayAddCardModal (MOVO-269 AC5)", () => {
  beforeEach(() => {
    mockWizardProps = null;
  });

  it("monta el wizard de MOVO-101 solo abierto y devuelve la tarjeta guardada", async () => {
    const onSaved = jest.fn();
    const { queryByTestId, rerender } = await render(
      <PayAddCardModal visible={false} cards={[]} onClose={jest.fn()} onSaved={onSaved} />,
    );
    expect(queryByTestId("wizard-mock")).toBeNull();

    await rerender(<PayAddCardModal visible cards={[]} onClose={jest.fn()} onSaved={onSaved} />);
    expect(queryByTestId("wizard-mock")).toBeTruthy();

    const card = { id: "c9" };
    await act(async () => mockWizardProps?.onSaved(card, { defaultFailed: false }));
    expect(onSaved).toHaveBeenCalledWith(card);
  });

  it("cancelar el wizard cierra el modal", async () => {
    const onClose = jest.fn();
    await render(<PayAddCardModal visible cards={undefined} onClose={onClose} onSaved={jest.fn()} />);
    await act(async () => mockWizardProps?.onCancel());
    expect(onClose).toHaveBeenCalled();
  });
});
