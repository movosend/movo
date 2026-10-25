import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import SupportHubScreen from "../app/(app)/support/index";
import { resetNavigationGuard } from "../src/lib/navigation-guard";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

let mockItems: unknown;
jest.mock("../src/hooks/use-support", () => ({ useSupportList: () => ({ data: mockItems }) }));

jest.mock("../components/tour/tour-replay-sheet", () => {
  const { Text } = require("react-native");
  return { TourReplaySheet: ({ visible }: { visible: boolean }) => (visible ? <Text>¿Qué querés repasar?</Text> : null) };
});

describe("SupportHubScreen (MOVO-324)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNavigationGuard();
    mockItems = undefined;
  });

  it("lista las opciones de ayuda: escribirle a Movo y repasar el tutorial", async () => {
    const { getByText } = await render(<SupportHubScreen />);

    expect(getByText("Ayuda y soporte")).toBeTruthy();
    expect(getByText("Chatea con Soporte de Movo")).toBeTruthy();
    expect(getByText("Repasar el tutorial")).toBeTruthy();
  });

  it("'Chatea con Soporte de Movo' abre Mis consultas", async () => {
    const { getByTestId } = await render(<SupportHubScreen />);

    await fireEvent.press(getByTestId("support-hub-chat"));

    expect(router.push).toHaveBeenCalledWith("/support/conversations");
  });

  it("'Repasar el tutorial' abre el sheet del tutorial y no navega", async () => {
    const { getByTestId, findByText, queryByText } = await render(<SupportHubScreen />);
    expect(queryByText("¿Qué querés repasar?")).toBeNull();

    await fireEvent.press(getByTestId("support-hub-tour"));

    expect(await findByText("¿Qué querés repasar?")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("muestra el total de consultas sin leer en la fila del chat", async () => {
    mockItems = [{ unreadCount: 2 }, { unreadCount: 1 }];
    const { getByTestId, queryByTestId } = await render(<SupportHubScreen />);

    expect(getByTestId("support-hub-chat-unread")).toHaveTextContent("3");
    expect(queryByTestId("support-hub-tour-unread")).toBeNull();
  });

  it("sin no leídos no muestra el contador", async () => {
    mockItems = [{ unreadCount: 0 }];
    const { queryByTestId } = await render(<SupportHubScreen />);
    expect(queryByTestId("support-hub-chat-unread")).toBeNull();
  });

  it("volver regresa a la pantalla anterior", async () => {
    const { getByTestId } = await render(<SupportHubScreen />);
    await fireEvent.press(getByTestId("support-hub-back"));
    expect(router.back).toHaveBeenCalled();
  });
});
