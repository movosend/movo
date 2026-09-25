import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createShipmentRepository, ShipmentRepository } from "../../repositories/shipment-repository";
import { createPositionRepository } from "../../repositories/position-repository";
import { BatchPositionInput, createPositionService, ReportPositionInput } from "../../services/position-service";
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

interface ReportPositionsBatchBody {
  positions: Array<ReportPositionBody & { shipmentId: string }>;
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

  // MOVO-250/AC4: lote para la tarea de segundo plano de MOVO-242 y el vaciado de la cola
  // offline de MOVO-203. Límite de requests: ver
  // `getRateLimitOverrides()` del gateway (AC5).
  app.post<{ Body: ReportPositionsBatchBody }>(
    "/positions",
    {
      schema: {
        summary: "Reportar posiciones GPS del transportista por lotes",
        description:
          "MOVO-250/AC4 y MOVO-251: hasta 100 posiciones (de uno o varios envíos) por request. Responde 200 con " +
          "un resultado por ítem, no todo-o-nada: `accepted` (con `persisted`, si entró a la traza) o " +
          "`rejected` con un código (SHIPMENT_NOT_TRACKABLE, NOT_FOUND, FORBIDDEN, INVALID_CAPTURED_AT). " +
          "La traza y la cadencia de 45s se agrupan por viaje (tripId) según `capturedAt` (no la hora de llegada), y la última " +
          "posición conocida/difusión avanzan a nivel de viaje con un `capturedAt` más reciente que el guardado.",
        tags: ["positions"],
        body: positionsSchemas.reportPositionsBatchBody,
        response: {
          200: positionsSchemas.reportPositionsBatchResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: ReportPositionsBatchBody }>) => {
      const callerId = requireUserIdFromHeader(request);
      const items: BatchPositionInput[] = request.body.positions.map((p) => ({
        shipmentId: p.shipmentId,
        lat: p.lat,
        lng: p.lng,
        accuracyM: p.accuracyM,
        capturedAt: new Date(p.capturedAt),
      }));
      return { results: await service.reportPositions(callerId, items) };
    }
  );

  app.post<{ Params: ShipmentIdParams; Body: ReportPositionBody }>(
    "/:id/positions",
    {
      schema: {
        summary: "Reportar la posición GPS actual del transportista",
        description:
          "MOVO-202 y MOVO-251: el transportista asignado de un envío en viaje activo (`assigned` o `in_transit`) puede " +
          "reportar -- 403 SHIPMENT_NOT_TRACKABLE si el viaje no está activo o el envío ya no es trackeable. El servidor " +
          "descarta la cadencia (persiste como mucho una posición por tramo de 45s de `capturedAt` en " +
          "Postgres por viaje, evidencia para disputas) sin confiar en el cliente; 422 INVALID_CAPTURED_AT si " +
          "`capturedAt` está en el futuro o es anterior al inicio del tránsito; la última posición conocida en Redis por viaje y la " +
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
