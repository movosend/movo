import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createShipmentsClient, type ShipmentsClient } from "../adapters/shipments-client";

/** Una instancia para webhooks, Saldo e Historial. Va después de cargar env. */
export default fp(async (app: FastifyInstance, opts: { shipmentsClient?: ShipmentsClient }) => {
  app.decorate("shipmentsClient", opts.shipmentsClient ?? createShipmentsClient(app.config.SHIPMENTS_SERVICE_URL));
});

declare module "fastify" {
  interface FastifyInstance {
    shipmentsClient: ShipmentsClient;
  }
}
