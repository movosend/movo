import { act, render } from "@testing-library/react-native";
import { SuccessToast } from "../components/ui/success-toast";

describe("SuccessToast", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("se cierra a los 3 s aunque el padre lo vuelva a renderizar con otra arrow de onDismiss", async () => {
    const dismissed = jest.fn();
    const { rerender } = await render(<SuccessToast testID="t" message="¡Viaje declarado!" onDismiss={() => dismissed()} />);

    await act(async () => jest.advanceTimersByTime(2000));
    await rerender(<SuccessToast testID="t" message="¡Viaje declarado!" onDismiss={() => dismissed()} />);
    await act(async () => jest.advanceTimersByTime(1000));

    expect(dismissed).toHaveBeenCalledTimes(1);
  });
});
