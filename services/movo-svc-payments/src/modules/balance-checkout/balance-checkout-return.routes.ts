import { FastifyInstance } from "fastify";
import { BALANCE_RETURN_RESULTS, BALANCE_RETURN_URL, BalanceReturnResult } from "./balance-checkout.service";

/**
 * MOVO-312: `back_urls` de la preferencia de Checkout Pro. La abre el navegador embebido del usuario al terminar
 * (o cancelar) el pago en Mercado Pago, sin JWT, así que vive fuera de `paymentsRoutes` y es pública en el gateway
 * (mismo criterio que el callback de OAuth de MOVO-111). MP no vuelve directo a un esquema custom: responde un 302 a
 * `movo://balance`, que es lo que cierra el navegador embebido.
 *
 * El resultado del query NO es de confianza (cualquiera lo puede armar): la app solo lo usa para decidir el texto y
 * vuelve a pedir el saldo. Los demás parámetros que MP agrega (`payment_id`, `status`, ...) no se leen ni se loguean.
 */
export default async function balanceCheckoutReturnRoutes(app: FastifyInstance) {
  app.get("/return", { schema: { hide: true } }, async (request, reply) => {
    const raw = (request.query as { result?: unknown }).result;
    const result: BalanceReturnResult = (BALANCE_RETURN_RESULTS as readonly unknown[]).includes(raw)
      ? (raw as BalanceReturnResult)
      : "failure";
    return reply.redirect(`${BALANCE_RETURN_URL}?result=${result}`, 302);
  });
}
