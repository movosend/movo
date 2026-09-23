import { fireEvent, render } from "@testing-library/react-native";
import NotificationCategoryDetailScreen from "../app/(app)/profile/notifications/[categoryId]";

const mockRouterBack = jest.fn();
let mockParams: { categoryId?: string } = { categoryId: "custody" };
jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args) },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));

const mockUseNotificationPreferences = jest.fn();
const mockMutate = jest.fn();
jest.mock("../src/hooks/use-notification-preferences", () => ({
  useNotificationPreferences: () => mockUseNotificationPreferences(),
  useUpdateNotificationPreferences: () => ({ mutate: mockMutate, isPending: false }),
}));

const mockGetNotificationPermissionStatus = jest.fn();
jest.mock("../src/lib/notification-permission", () => ({
  getNotificationPermissionStatus: () => mockGetNotificationPermissionStatus(),
}));

const PREFS = {
  pushEnabled: true,
  quietHours: { enabled: false, from: "23:00", to: "08:00" },
  categories: [{ id: "custody", enabled: true }],
};

describe("NotificationCategoryDetailScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { categoryId: "custody" };
    mockUseNotificationPreferences.mockReturnValue({ data: PREFS, isLoading: false, isError: false });
    mockGetNotificationPermissionStatus.mockResolvedValue({ granted: true, canAskAgain: true });
  });

  it("vuelve atrás desde el header", async () => {
    const { getByTestId } = await render(<NotificationCategoryDetailScreen />);

    await fireEvent.press(getByTestId("notification-detail-back"));

    expect(mockRouterBack).toHaveBeenCalled();
  });

  it("muestra los triggers reales de una categoría implementada", async () => {
    const { getByTestId, queryByTestId } = await render(<NotificationCategoryDetailScreen />);

    expect(getByTestId("notification-detail-trigger-0")).toBeTruthy();
    expect(queryByTestId("notification-detail-pending-note")).toBeNull();
  });

  it("togglear el push de la categoría dispara la mutación", async () => {
    const { getByTestId } = await render(<NotificationCategoryDetailScreen />);

    await fireEvent.press(getByTestId("notification-detail-toggle"));

    expect(mockMutate).toHaveBeenCalledWith({ categories: { custody: false } }, expect.anything());
  });

  it("una categoría 'Pronto' no lista triggers y avisa que no está disponible", async () => {
    mockParams = { categoryId: "kyc" };

    const { getByTestId, queryByTestId } = await render(<NotificationCategoryDetailScreen />);

    expect(getByTestId("notification-detail-pending-note")).toBeTruthy();
    expect(queryByTestId("notification-detail-trigger-0")).toBeNull();
  });

  it("muestra error si el id de categoría no existe en el catálogo", async () => {
    mockParams = { categoryId: "no-existe" };

    const { getByTestId } = await render(<NotificationCategoryDetailScreen />);

    expect(getByTestId("notification-detail-error")).toBeTruthy();
  });
});
