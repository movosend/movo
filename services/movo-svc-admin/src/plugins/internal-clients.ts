import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createUsersClient, UsersClient } from "../adapters/users-client";
import { createShipmentsClient, ShipmentsClient } from "../adapters/shipments-client";
import { createPaymentsClient, PaymentsClient } from "../adapters/payments-client";
import { createSupportClient, SupportClient } from "../adapters/support-client";

export interface InternalClientsOptions {
  /** Overrides solo para tests: evitan salir a la red, mismo criterio que `buildApp` de svc-shipments. */
  usersClient?: UsersClient;
  shipmentsClient?: ShipmentsClient;
  paymentsClient?: PaymentsClient;
  supportClient?: SupportClient;
}

export default fp<InternalClientsOptions>(async (app: FastifyInstance, opts: InternalClientsOptions) => {
  app.decorate("usersClient", opts.usersClient ?? createUsersClient(app.config));
  app.decorate("shipmentsClient", opts.shipmentsClient ?? createShipmentsClient(app.config));
  app.decorate("paymentsClient", opts.paymentsClient ?? createPaymentsClient(app.config));
  app.decorate("supportClient", opts.supportClient ?? createSupportClient(app.config));
});

declare module "fastify" {
  interface FastifyInstance {
    usersClient: UsersClient;
    shipmentsClient: ShipmentsClient;
    paymentsClient: PaymentsClient;
    supportClient: SupportClient;
  }
}
