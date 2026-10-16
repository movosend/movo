import { FastifyInstance } from "fastify";
import type { CreateBalanceCheckoutRequest } from "@movo/shared";
import { createBalanceCheckoutSchema } from "./balance-checkout.schema";

/**
 * MOVO-312: `POST /payments/balance/checkout`. Se registra dentro de `paymentsRoutes` para heredar su hook de
 * `x-user-id`; cada usuario paga solo lo suyo.
 */
export default async function balanceCheckoutRoutes(app: FastifyInstance) {
  app.post("/", { schema: createBalanceCheckoutSchema }, async (request) => {
    const raw = request.headers["x-user-id"];
    const userId = (Array.isArray(raw) ? raw[0] : raw) as string;
    const { amountArs } = request.body as CreateBalanceCheckoutRequest;
    return app.balanceCheckout.createCheckout(userId, amountArs);
  });
}
