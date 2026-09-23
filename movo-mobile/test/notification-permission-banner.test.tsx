import { fireEvent, render } from "@testing-library/react-native";
import { Linking } from "react-native";
import { NotificationPermissionBanner } from "../components/notifications/notification-permission-banner";

describe("NotificationPermissionBanner", () => {
  beforeEach(() => {
    jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("abre los ajustes del sistema al tocar el botón", async () => {
    const { getByTestId } = await render(<NotificationPermissionBanner testID="banner" />);

    await fireEvent.press(getByTestId("banner-open-settings"));

    expect(Linking.openSettings).toHaveBeenCalled();
  });
});
