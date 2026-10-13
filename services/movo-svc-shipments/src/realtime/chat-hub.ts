import type { WebSocket } from "ws";
import { RealtimeRegistry } from "../plugins/realtime";

/**
 * MOVO-26 (ADR-040): sockets del chat. Instancia propia de `RealtimeRegistry` (no la de
 * tracking): así un mensaje de chat no llega a quien solo mira el mapa y el cierre `4009` de
 * tracking por un envío entregado no corta el chat, que sigue 24 h más. Además cuenta los
 * sockets por usuario, para no mandar una push a quien ya tiene el chat abierto.
 * En memoria y de una sola réplica, igual que el resto del canal (ADR-006/022).
 */
export class ChatHub {
  private readonly registry = new RealtimeRegistry();
  private readonly socketsByUser = new Map<string, Map<string, number>>();

  register(shipmentId: string, userId: string, socket: WebSocket): void {
    this.registry.register(shipmentId, socket);
    let users = this.socketsByUser.get(shipmentId);
    if (!users) {
      users = new Map();
      this.socketsByUser.set(shipmentId, users);
    }
    users.set(userId, (users.get(userId) ?? 0) + 1);
  }

  unregister(shipmentId: string, userId: string, socket: WebSocket): void {
    this.registry.unregister(shipmentId, socket);
    const users = this.socketsByUser.get(shipmentId);
    if (!users) return;
    const remaining = (users.get(userId) ?? 0) - 1;
    if (remaining > 0) {
      users.set(userId, remaining);
      return;
    }
    users.delete(userId);
    if (users.size === 0) this.socketsByUser.delete(shipmentId);
  }

  /** ¿Tiene `userId` el chat de este envío abierto en algún dispositivo? */
  isUserConnected(shipmentId: string, userId: string): boolean {
    return (this.socketsByUser.get(shipmentId)?.get(userId) ?? 0) > 0;
  }

  activeConnections(shipmentId?: string): number {
    return this.registry.activeConnections(shipmentId);
  }

  broadcast(shipmentId: string, message: unknown): void {
    this.registry.broadcast(shipmentId, message);
  }

  close(shipmentId: string, code: number, reason: string): void {
    this.registry.close(shipmentId, code, reason);
  }
}

declare module "fastify" {
  interface FastifyInstance {
    chatHub: ChatHub;
  }
}
