import { describe, it, expect, vi } from "vitest";
import type { WebSocket } from "ws";
import { RealtimeRegistry } from "../src/plugins/realtime";

function fakeSocket(readyState: number, send = vi.fn()): WebSocket {
  return { readyState, send } as unknown as WebSocket;
}

describe("RealtimeRegistry.broadcast (MOVO-250/AC8)", () => {
  it("solo envía a sockets OPEN", () => {
    const registry = new RealtimeRegistry();
    const open = fakeSocket(1);
    const connecting = fakeSocket(0);
    const closing = fakeSocket(2);
    const closed = fakeSocket(3);
    for (const socket of [open, connecting, closing, closed]) registry.register("s1", socket);

    registry.broadcast("s1", { type: "status" });

    expect(open.send).toHaveBeenCalledWith(JSON.stringify({ type: "status" }));
    expect(connecting.send).not.toHaveBeenCalled();
    expect(closing.send).not.toHaveBeenCalled();
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("un socket que tira al enviar no corta el reparto al resto", () => {
    const registry = new RealtimeRegistry();
    const broken = fakeSocket(
      1,
      vi.fn(() => {
        throw new Error("EPIPE");
      })
    );
    const healthy = fakeSocket(1);
    registry.register("s1", broken);
    registry.register("s1", healthy);

    expect(() => registry.broadcast("s1", { n: 1 })).not.toThrow();
    expect(healthy.send).toHaveBeenCalledTimes(1);
  });

  it("es silencioso sin suscriptores", () => {
    expect(() => new RealtimeRegistry().broadcast("nadie", {})).not.toThrow();
  });
});
