import fp from "fastify-plugin";
import websocket from "@fastify/websocket";
import { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  onShipmentStatusChanged,
  ShipmentStatusChangedEvent,
} from "../realtime/shipment-status-events";
import { TRACKING_CLOSED_STATUSES } from "../domain/shipment-state-machine";

/** Cierre WS "privado" (RFC 6455, >=4000) propio del proyecto -- el envío pasó a un
 * estado que corta el tracking (MOVO-201/AC4) mientras el socket seguía abierto.
 * Distinto de los códigos de rechazo al conectar (4001/4003/4004, `tracking.routes.ts`):
 * este cierra una conexión que SÍ estaba autorizada. */
export const TRACKING_STATUS_CLOSED_WS_CODE = 4009;

/**
 * MOVO-201/AC8: registro en memoria de sockets activos por envío -- agnóstico del tipo
 * de mensaje que viaje por ellos (posición, chat, evento de handshake), para que
 * `tracking.routes.ts` (y cualquier canal futuro que reuse el mismo envío) no tenga que
 * reimplementar el mapeo shipmentId -> suscriptores. En memoria y sin distribución entre
 * réplicas a propósito, mismo criterio que `shipment-status-events.ts`: `svc-shipments`
 * corre en una sola instancia (ADR-006).
 */
export class RealtimeRegistry {
  private readonly connectionsByShipment = new Map<string, Set<WebSocket>>();

  register(shipmentId: string, socket: WebSocket): void {
    let sockets = this.connectionsByShipment.get(shipmentId);
    if (!sockets) {
      sockets = new Set();
      this.connectionsByShipment.set(shipmentId, sockets);
    }
    sockets.add(socket);
  }

  unregister(shipmentId: string, socket: WebSocket): void {
    const sockets = this.connectionsByShipment.get(shipmentId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.connectionsByShipment.delete(shipmentId);
    }
  }

  /** Cantidad de sockets activos, total o de un envío puntual -- métrica mínima (AC7). */
  activeConnections(shipmentId?: string): number {
    if (shipmentId) {
      return this.connectionsByShipment.get(shipmentId)?.size ?? 0;
    }
    let total = 0;
    for (const sockets of this.connectionsByShipment.values()) {
      total += sockets.size;
    }
    return total;
  }

  close(shipmentId: string, code: number, reason: string): void {
    const sockets = this.connectionsByShipment.get(shipmentId);
    if (!sockets) return;
    // Copia del Set: `socket.close()` dispara el listener "close" del handler
    // (tracking.routes.ts), que llama a `unregister` y mutaría este mismo Set
    // mientras lo recorremos.
    for (const socket of [...sockets]) {
      socket.close(code, reason);
    }
  }
}

declare module "fastify" {
  interface FastifyInstance {
    realtimeRegistry: RealtimeRegistry;
  }
}

/**
 * MOVO-201: reemplaza al `websocket.ts` de la PoC de MOVO-200 -- además de registrar
 * `@fastify/websocket` (sigue siendo necesario, `{ websocket: true }` en una ruta lanza
 * FST_ERR_MISSING_PLUGIN sin esto), decora la app con `realtimeRegistry` y se suscribe a
 * `shipment-status-events` para cortar en el acto el tracking de un envío que llegó a
 * `TRACKING_CLOSED_STATUSES` (AC4) sin esperar a que el cliente reconecte.
 */
export default fp(async (app: FastifyInstance) => {
  await app.register(websocket);

  const registry = new RealtimeRegistry();
  app.decorate("realtimeRegistry", registry);

  onShipmentStatusChanged((event: ShipmentStatusChangedEvent) => {
    if (!TRACKING_CLOSED_STATUSES.includes(event.to)) return;
    const activeBeforeClose = registry.activeConnections(event.shipmentId);
    if (activeBeforeClose === 0) return;
    app.log.info(
      { shipmentId: event.shipmentId, toStatus: event.to, activeConnections: activeBeforeClose },
      "realtime: cerrando tracking por cambio de estado"
    );
    registry.close(event.shipmentId, TRACKING_STATUS_CLOSED_WS_CODE, `El envío pasó a '${event.to}'.`);
  });
});
