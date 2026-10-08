import { FastifyInstance } from "fastify";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function paymentsRoutes(app: FastifyInstance) {
  // ADR-010: el gateway valida el JWT e inyecta `x-user-id`; este servicio confía en
  // el header sin revalidar. Se exige acá, a nivel del módulo, para que toda ruta
  // nueva de /payments (MOVO-111, 209, 212) nazca protegida en vez de depender de que
  // cada autor se acuerde de agregar el chequeo. Las rutas que llama Mercado Pago sin
  // JWT (callback OAuth, webhook) van en un módulo aparte, fuera de este hook.
  app.addHook("onRequest", async (request, reply) => {
    const raw = request.headers["x-user-id"];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (!userId || !UUID_PATTERN.test(userId)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/", async () => {
    return { module: "payments" };
  });
}
