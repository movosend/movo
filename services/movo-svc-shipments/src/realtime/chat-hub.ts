import type { WebSocket } from "ws";

/** `readyState` de un socket abierto (literal: `ws` es devDependency, `src/` solo lo usa como tipo). */
const WS_READY_STATE_OPEN = 1;

/**
 * MOVO-26 (ADR-040): sockets del chat, por envío y por usuario. Es una estructura propia, no el
 * `RealtimeRegistry` de tracking: un mensaje de chat no llega a quien solo mira el mapa, el cierre `4009`
 * de tracking por un envío entregado no corta el chat, y acá cada usuario recibe SU versión del mensaje
 * (el contenido de alguien que bloqueó llega vacío, y los tildes son solo del autor).
 * En memoria y de una sola réplica, igual que el resto del canal (ADR-006/022).
 */
export class ChatHub {
  private readonly sockets = new Map<string, Map<string, Set<WebSocket>>>();

  register(shipmentId: string, userId: string, socket: WebSocket): void {
    let users = this.sockets.get(shipmentId);
    if (!users) {
      users = new Map();
      this.sockets.set(shipmentId, users);
    }
    let own = users.get(userId);
    if (!own) {
      own = new Set();
      users.set(userId, own);
    }
    own.add(socket);
  }

  unregister(shipmentId: string, userId: string, socket: WebSocket): void {
    const users = this.sockets.get(shipmentId);
    const own = users?.get(userId);
    if (!users || !own) return;
    own.delete(socket);
    if (own.size === 0) users.delete(userId);
    if (users.size === 0) this.sockets.delete(shipmentId);
  }

  /** ¿Tiene `userId` el chat de este envío abierto en algún dispositivo? */
  isUserConnected(shipmentId: string, userId: string): boolean {
    return (this.sockets.get(shipmentId)?.get(userId)?.size ?? 0) > 0;
  }

  /** Usuarios con el chat abierto en este envío. */
  connectedUserIds(shipmentId: string): string[] {
    return [...(this.sockets.get(shipmentId)?.keys() ?? [])];
  }

  activeConnections(shipmentId?: string): number {
    if (shipmentId) {
      let total = 0;
      for (const own of this.sockets.get(shipmentId)?.values() ?? []) total += own.size;
      return total;
    }
    let total = 0;
    for (const users of this.sockets.values()) for (const own of users.values()) total += own.size;
    return total;
  }

  /** Manda `message` a todos los dispositivos de un usuario. Un socket roto no corta el reparto. */
  sendToUser(shipmentId: string, userId: string, message: unknown): void {
    const own = this.sockets.get(shipmentId)?.get(userId);
    if (!own || own.size === 0) return;
    const payload = JSON.stringify(message);
    for (const socket of own) {
      if (socket.readyState !== WS_READY_STATE_OPEN) continue;
      try {
        socket.send(payload);
      } catch {
        // El socket se limpia solo por su propio listener "close"/"error".
      }
    }
  }

  close(shipmentId: string, code: number, reason: string): void {
    const users = this.sockets.get(shipmentId);
    if (!users) return;
    // Copia: `socket.close()` dispara el "close" del handler, que llama a `unregister` y mutaría el mapa.
    for (const own of [...users.values()]) for (const socket of [...own]) socket.close(code, reason);
  }
}

declare module "fastify" {
  interface FastifyInstance {
    chatHub: ChatHub;
  }
}
