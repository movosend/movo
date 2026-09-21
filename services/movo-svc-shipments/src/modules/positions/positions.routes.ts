import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createShipmentRepository, ShipmentRepository } from "../../repositories/shipment-repository";
import { createPositionRepository } from "../../repositories/position-repository";
import { createPositionService, ReportPositionInput } from "../../services/position-service";
import { positionsSchemas } from "./positions.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";

export interface PositionsRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración -- mismo criterio que el resto de los
   * módulos (`shipmentRepository`/`usersClient`/etc). */
  shipmentRepository?: ShipmentRepository;
}

interface ShipmentIdParams {
  id: string;
}

interface ReportPositionBody {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string;
}

/**
 * MOVO-202 (AC1-AC5): ingesta HTTP de posiciones GPS, no un mensaje sobre el WS de
 * MOVO-201 -- decisión deliberada, el AC1 del ticket dejaba la elección abierta
 * ("endpoint o mensaje de canal"). El consumidor real (MOVO-203, emisión en
 * foreground/background) va a reportar desde tareas en segundo plano del SO, donde
 * mantener un WebSocket vivo es frágil (el sistema operativo mata sockets en
 * background mucho antes de matar una tarea de red puntual) -- un POST HTTP corriente,
 * el mismo patrón de autenticación (`x-user-id` del gateway) que el resto del
 * servicio, es la vía robusta. El canal de MOVO-201 sigue siendo exclusivamente el de
 * RECEPCIÓN: el mapa (emisor/receptor, MOVO-204) se suscribe ahí y recibe cada
 * posición que este endpoint difunde (`app.realtimeRegistry.broadcast`, AC5) sin
 * esperar la persistencia.
 */
export default async function positionsRoutes(app: FastifyInstance, opts: PositionsRoutesOptions) {
  const shipmentRepository = opts.shipmentRepository ?? createShipmentRepository(app.db);
  const positionRepository = createPositionRepository(app.db);
  const service = createPositionService(
    shipmentRepository,
    positionRepository,
    app.redis,
    app.realtimeRegistry,
    app.log
  );

  app.post<{ Params: ShipmentIdParams; Body: ReportPositionBody }>(
    "/:id/positions",
    {
      schema: {
        summary: "Reportar la posición GPS actual del transportista",
        description:
          "AC1/AC2/AC4 de MOVO-202: solo el transportista asignado de un envío `in_transit` puede " +
          "reportar -- 403 para cualquier otro actor o estado (SHIPMENT_NOT_IN_TRANSIT). El servidor " +
          "descarta la cadencia (persiste como mucho una posición cada ~45s en Postgres, evidencia " +
          "para disputas) sin confiar en el cliente; la última posición conocida en Redis y la " +
          "difusión a los suscriptores del canal de tiempo real (MOVO-201) pasan siempre, sin esperar " +
          "esa persistencia.",
        tags: ["positions"],
        params: positionsSchemas.shipmentIdParam,
        body: positionsSchemas.reportPositionBody,
        response: {
          202: positionsSchemas.reportPositionResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: ShipmentIdParams; Body: ReportPositionBody }>, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id: shipmentId } = request.params;
      const { lat, lng, accuracyM, capturedAt } = request.body;

      // El schema (`format: "date-time"`) ya rechaza con 400 cualquier string no
      // parseable antes de llegar acá -- `new Date(capturedAt)` nunca resulta en
      // Invalid Date en este punto.
      const input: ReportPositionInput = { lat, lng, accuracyM, capturedAt: new Date(capturedAt) };
      const result = await service.reportPosition(shipmentId, callerId, input);
      reply.code(202);
      return result;
    }
  );
}
