import { FastifyInstance } from "fastify";
import type { CaptureHoldRequest } from "@movo/shared";
import type { CaptureRequest } from "./capture.service";
import { captureHoldSchema, getSettlementSchema } from "./settlements.schema";

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
      preValidation: async (request) => {
        request.body ??= {};
      },
    },
    async (request) => {
      const { shipmentId } = request.params as { shipmentId: string };
      // El schema ya garantiza que la penalidad trae `amountArs` y la entrega no.
      const body = request.body as CaptureHoldRequest;
      const capture: CaptureRequest =
        body.kind === "cancellation_penalty"
          ? { kind: "cancellation_penalty", amountArs: body.amountArs as number }
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
