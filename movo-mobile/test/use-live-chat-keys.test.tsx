import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { useLiveChatKeys } from "../src/hooks/use-live-chat-keys";
import type { ChatTimelineItem } from "../src/lib/chat-format";

function msg(key: string): ChatTimelineItem {
  return {
    kind: "message",
    key,
    mine: false,
    showName: true,
    showAvatar: true,
    groupStart: true,
    message: {
      id: key,
      shipmentId: "s1",
      authorId: "a",
      authorName: null,
      body: key,
      clientMessageId: key,
      moderated: false,
      hidden: false,
      deliveryStatus: null,
      createdAt: new Date().toISOString(),
    },
  };
}

let latest: ReturnType<typeof useLiveChatKeys>;
function Probe({ timeline, ready = true }: { timeline: ChatTimelineItem[]; ready?: boolean }) {
  latest = useLiveChatKeys(timeline, ready);
  return <Text>probe</Text>;
}

describe("useLiveChatKeys (MOVO-301)", () => {
  afterEach(() => jest.useRealTimers());

  it("el historial que ya estaba al abrir no es en vivo", async () => {
    await render(<Probe timeline={[msg("m3"), msg("m2"), msg("m1")]} />);
    expect(latest.liveKeys.size).toBe(0);
    expect(latest.arrivals).toEqual([]);
  });

  it("un mensaje nuevo al frente (propio o ajeno) es en vivo", async () => {
    const { rerender } = await render(<Probe timeline={[msg("m2"), msg("m1")]} />);
    await rerender(<Probe timeline={[msg("m3"), msg("m2"), msg("m1")]} />);
    expect(latest.liveKeys.has("m3")).toBe(true);
    expect(latest.arrivals.map((i) => i.key)).toEqual(["m3"]);
  });

  it("lo que se agrega al final por paginación no se anima", async () => {
    const { rerender } = await render(<Probe timeline={[msg("m2"), msg("m1")]} />);
    await rerender(<Probe timeline={[msg("m2"), msg("m1"), msg("m0")]} />);
    expect(latest.liveKeys.size).toBe(0);
    expect(latest.arrivals).toEqual([]);
  });

  it("el mensaje propio que pasa de enviándose a enviado conserva la key: no vuelve a animarse", async () => {
    const { rerender } = await render(<Probe timeline={[msg("m1")]} />);
    await rerender(<Probe timeline={[msg("local-1"), msg("m1")]} />);
    expect(latest.arrivals.map((i) => i.key)).toEqual(["local-1"]);
    await rerender(<Probe timeline={[msg("local-1"), msg("m1")].map((i) => ({ ...i }))} />);
    expect(latest.arrivals).toEqual([]);
  });

  it("la key en vivo se retira sola: volver a montar la burbuja ya no la anima", async () => {
    jest.useFakeTimers();
    const { rerender } = await render(<Probe timeline={[msg("m1")]} />);
    await rerender(<Probe timeline={[msg("m2"), msg("m1")]} />);
    expect(latest.liveKeys.has("m2")).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(latest.liveKeys.has("m2")).toBe(false);
  });

  it("mientras no está lista la conversación no hay línea base: el primer mensaje en un chat vacío sí se anima", async () => {
    const { rerender } = await render(<Probe timeline={[]} ready />);
    await rerender(<Probe timeline={[msg("m1")]} ready />);
    expect(latest.liveKeys.has("m1")).toBe(true);
  });
});
