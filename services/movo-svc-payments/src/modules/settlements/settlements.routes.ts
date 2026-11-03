import { FastifyInstance } from "fastify";
import { ApiError, type CaptureHoldRequest } from "@movo/shared";
import type { CaptureRequest } from "./capture.service";
import { captureHoldSchema, getSettlementSchema, listSettlementIssuesSchema } from "./settlements.schema";

/** Campos que acepta el body de la captura. */
const CAPTURE_BODY_KEYS = new Set(["kind", "amountArs"]);

/**
 * MOVO-212: endpoints INTERNOS de captura y liquidación, los consume `movo-svc-shipments`
 * (tras la entrega y desde su barrido). Cuelgan del MISMO prefijo que los holds
 * (`/internal/payments/holds`), así el `PaymentsClient` de MOVO-210 los alcanza sin otra
 * base. Mismo criterio que los holds (MOVO-209): sin ruta
 * en el gateway ni hook de `x-user-id`, solo alcanzables desde la red interna (ADR-010).
 * El detalle por rol (transportista / emisor / receptor, AC10) lo filtra `svc-shipments`,
 * que es quien conoce quién es quién en el envío.
 */
export default async function settlementsRoutes(app: FastifyInstance) {
  const service = app.captures;

  app.post(
    "/by-shipment/:shipmentId/capture",
    {
      schema: captureHoldSchema,
      // Sin body (MOVO-212, como llama `svc-shipments` hoy) es una entrega: Fastify validaría
      // `undefined` contra el schema y respondería 400, así que se valida como `{}`.
      // Review de PR #261: Ajv de Fastify borra en silencio las claves de más
      // (`removeAdditional`), así que un `{ amount: 300 }` mal escrito llegaba como `{}` y
      // capturaba el hold ENTERO como entrega. Acá se rechaza con 400 antes de validar.
      preValidation: async (request) => {
        request.body ??= {};
        const body = request.body;
        const unknown = typeof body === "object" && body !== null && !Array.isArray(body)
          ? Object.keys(body).filter((key) => !CAPTURE_BODY_KEYS.has(key))
          : [];
        if (unknown.length > 0) {
          throw new ApiError(400, "VALIDATION_FAILED", `Campos desconocidos en la captura: ${unknown.join(", ")}`);
        }
      },
    },
    async (request) => {
      const { shipmentId } = request.params as { shipmentId: string };
      // El schema ya garantiza que la penalidad trae `amountArs` y la entrega no.
      const body = request.body as CaptureHoldRequest;
      const capture: CaptureRequest =
        body.kind === "cancellation_penalty" || body.kind === "dispute_partial"
          ? { kind: body.kind, amountArs: body.amountArs as number }
          : { kind: "delivery" };
      const { settlement } = await service.capture(shipmentId, capture);
      return { settlement };
    }
  );

  app.get("/by-shipment/:shipmentId/settlement", { schema: getSettlementSchema }, async (request) => {
    const { shipmentId } = request.params as { shipmentId: string };
    return service.getByShipment(shipmentId);
  });
}

/**
 * MOVO-213 (AC6): consulta interna de las liquidaciones que necesitan atención, el punto de partida del proceso
 * manual. `GET /internal/payments/settlements?status=failed|escalated`. Interno como el resto (ADR-010); el panel de
 * admin (MOVO-33) lo expondrá vía `svc-admin` cuando exista su pantalla.
 */
export async function settlementIssuesRoutes(app: FastifyInstance) {
  app.get("/", { schema: listSettlementIssuesSchema }, async (request) => {
    const { status, limit = 50, cursor } = request.query as { status: "failed" | "escalated"; limit?: number; cursor?: string };
    return app.captures.listIssues(status, limit, cursor);
  });
}
