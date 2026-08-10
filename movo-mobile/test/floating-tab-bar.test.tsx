import { render, fireEvent } from "@testing-library/react-native";
import { FloatingTabBar } from "../components/tab-bar/floating-tab-bar";
import { TAB_BAR_ITEMS } from "../components/tab-bar/tab-config";

const mockNavigate = jest.fn();
const mockEmit = jest.fn().mockReturnValue({ defaultPrevented: false });

function buildProps(activeIndex: number) {
  const routes = TAB_BAR_ITEMS.map((item, index) => ({
    key: `${item.name}-key`,
    name: item.name,
  }));

  return {
    state: { index: activeIndex, routes } as never,
    descriptors: {} as never,
    navigation: { navigate: mockNavigate, emit: mockEmit } as never,
    insets: { top: 0, bottom: 0, left: 0, right: 0 } as never,
  };
}

describe("FloatingTabBar (MOVO-78)", () => {
  afterEach(() => jest.clearAllMocks());

  it("marca como seleccionado solo el tab activo (accessibilityState)", async () => {
    const { getByTestId } = await render(<FloatingTabBar {...buildProps(0)} />);

    expect(getByTestId("tab-bar-button-home").props.accessibilityState.selected).toBe(true);
    expect(getByTestId("tab-bar-button-transport").props.accessibilityState.selected).toBe(false);
    expect(getByTestId("tab-bar-button-profile").props.accessibilityState.selected).toBe(false);
  });

  it("navega al tab tocado cuando no es el activo", async () => {
    const { getByTestId } = await render(<FloatingTabBar {...buildProps(0)} />);

    fireEvent.press(getByTestId("tab-bar-button-profile"));

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tabPress", target: "profile-key" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("profile");
  });

  it("no navega si se toca el tab ya activo", async () => {
    const { getByTestId } = await render(<FloatingTabBar {...buildProps(1)} />);

    fireEvent.press(getByTestId("tab-bar-button-transport"));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
