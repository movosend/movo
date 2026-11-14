import { fireEvent, render } from "@testing-library/react-native";
import { LiveTrackingSheet, LIVE_TRACKING_PRIVACY_TEXT } from "../components/shipments/live-tracking-sheet";

jest.mock("../src/hooks/use-chat", () => ({
  useChatList: () => ({ data: [{ shipmentId: "s1", unreadCount: 2 }] }),
}));
jest.mock("../components/shipments/counterpart-card", () => {
  const { Text } = require("react-native");
  return { CounterpartCard: ({ userId }: { userId: string }) => <Text>{userId}</Text> };
});

const ETA = { kind: "eta" as const, target: "delivery" as const, km: 18.4, minutes: 37 };

/** MOVO-361 AC2: lo que tenía la pantalla "Seguimiento en vivo", en el sheet del mapa a pantalla completa. */
describe("LiveTrackingSheet", () => {
  it("muestra llegada estimada, km, transportista, chat y el aviso de privacidad", async () => {
    const onNavigate = jest.fn();
    const { getByTestId, getByText } = await render(
      <LiveTrackingSheet shipmentId="s1" estimate={ETA} carrierId="carrier-1" chat="open" onNavigate={onNavigate} />,
    );

    expect(getByText("Llegada estimada")).toBeTruthy();
    expect(getByTestId("live-tracking-sheet-eta-km")).toHaveTextContent(/18,4 km hasta el destino/);
    expect(getByText("carrier-1")).toBeTruthy();
    expect(getByTestId("live-tracking-sheet-chat-unread")).toBeTruthy();
    expect(getByText(LIVE_TRACKING_PRIVACY_TEXT)).toBeTruthy();

    await fireEvent.press(getByTestId("live-tracking-sheet-chat"));
    expect(onNavigate).toHaveBeenCalledWith("/(app)/shipments/s1/chat");
  });

  it("al retiro lo dice", async () => {
    const { getByText, getByTestId } = await render(
      <LiveTrackingSheet
        shipmentId="s1"
        estimate={{ ...ETA, target: "pickup", km: 3 }}
        carrierId="carrier-1"
        chat="open"
        onNavigate={jest.fn()}
      />,
    );

    expect(getByText("Llegada estimada al retiro")).toBeTruthy();
    expect(getByTestId("live-tracking-sheet-eta-km")).toHaveTextContent(/hasta el retiro/);
  });

  it("con la etapa no inventa una hora", async () => {
    const { getByText, queryByText } = await render(
      <LiveTrackingSheet
        shipmentId="s1"
        estimate={{ kind: "stage", text: "El transportista todavía no retiró el paquete" }}
        carrierId="carrier-1"
        chat="read_only"
        onNavigate={jest.fn()}
      />,
    );

    expect(getByText("El transportista todavía no retiró el paquete")).toBeTruthy();
    expect(queryByText("Llegada estimada")).toBeNull();
  });
});
