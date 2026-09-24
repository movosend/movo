import { fireEvent, render } from "@testing-library/react-native";
import { ToggleSwitch } from "../components/ui/toggle-switch";

describe("ToggleSwitch", () => {
  it("dispara onChange con el valor invertido al tocarlo", async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ToggleSwitch value={false} onChange={onChange} testID="toggle" />,
    );

    await fireEvent.press(getByTestId("toggle"));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("no dispara onChange si está disabled", async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ToggleSwitch value={false} onChange={onChange} disabled testID="toggle" />,
    );

    await fireEvent.press(getByTestId("toggle"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("expone el estado real vía accessibilityState, incluso dimmed", async () => {
    const { getByTestId } = await render(
      <ToggleSwitch value={true} onChange={jest.fn()} dimmed testID="toggle" />,
    );

    expect(getByTestId("toggle").props.accessibilityState).toEqual({ checked: true, disabled: false });
  });
});
