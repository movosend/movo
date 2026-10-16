import { FastifyInstance } from "fastify";
import type { BalancePayRequest } from "@movo/shared";
import { balancePayDataSchema, balancePaySchema } from "./balance-payment.schema";

function userIdOf(headers: Record<string, unknown>): string {
  const raw = headers["x-user-id"];
  return (Array.isArray(raw) ? raw[0] : raw) as string;
}

/**
 * MOVO-312: `GET /payments/balance/pay-data` y `POST /payments/balance/pay`. Se registran dentro de `paymentsRoutes`
 * para heredar su hook de `x-user-id`; cada usuario paga solo lo suyo.
 */
export default async function balancePaymentRoutes(app: FastifyInstance) {
  app.get("/pay-data", { schema: balancePayDataSchema }, async (request) =>
    app.balancePayment.getPayData(userIdOf(request.headers))
  );

  app.post("/pay", { schema: balancePaySchema }, async (request) => {
    return app.balancePayment.pay(userIdOf(request.headers), request.body as BalancePayRequest);
  });
}
