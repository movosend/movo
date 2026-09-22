import { fireEvent, render } from "@testing-library/react-native";
import QuietHoursScreen from "../app/(app)/profile/notifications/quiet-hours";

const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args) },
}));

const mockUseNotificationPreferences = jest.fn();
const mockMutate = jest.fn();
jest.mock("../src/hooks/use-notification-preferences", () => ({
  useNotificationPreferences: () => mockUseNotificationPreferences(),
  useUpdateNotificationPreferences: () => ({ mutate: mockMutate, isPending: false }),
}));

const PREFS = {
  pushEnabled: true,
  quietHours: { enabled: true, from: "23:00", to: "08:00" },
  categories: [],
};

describe("QuietHoursScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNotificationPreferences.mockReturnValue({ data: PREFS, isLoading: false, isError: false });
  });

  it("vuelve atrás desde el header", async () => {
    const { getByTestId } = await render(<QuietHoursScreen />);

    await fireEvent.press(getByTestId("quiet-hours-back"));

    expect(mockRouterBack).toHaveBeenCalled();
  });

  it("togglear activar/desactivar dispara la mutación de quietHours.enabled", async () => {
    const { getByTestId } = await render(<QuietHoursScreen />);

    await fireEvent.press(getByTestId("quiet-hours-toggle"));

    expect(mockMutate).toHaveBeenCalledWith({ quietHours: { enabled: false } }, expect.anything());
  });

  it("tocar 'Desde' cicla al siguiente valor fijo de la franja nocturna", async () => {
    const { getByTestId } = await render(<QuietHoursScreen />);

    await fireEvent.press(getByTestId("quiet-hours-from"));

    expect(mockMutate).toHaveBeenCalledWith({ quietHours: { from: "00:00" } }, expect.anything());
  });

  it("tocar 'Hasta' cicla al siguiente valor fijo", async () => {
    const { getByTestId } = await render(<QuietHoursScreen />);

    await fireEvent.press(getByTestId("quiet-hours-to"));

    expect(mockMutate).toHaveBeenCalledWith({ quietHours: { to: "09:00" } }, expect.anything());
  });
});
