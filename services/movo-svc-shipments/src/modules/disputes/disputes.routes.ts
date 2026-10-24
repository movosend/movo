import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { DisputeReason } from "@movo/shared";
import { createDisputesService, DisputesService } from "./disputes.service";
import { disputesSchemas } from "./disputes.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createDisputeRepository } from "../../repositories/dispute-repository";
import {
  createStorageProvider,
  StorageProvider,
} from "../../adapters/storage-provider";
import {
  createNotificationsClient,
  NotificationsClient,
} from "../../adapters/notifications-client";
import {
  AlertNotifier,
  createAlertNotifier,
} from "../../adapters/alert-notifier";

export interface DisputesRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración, mismo criterio que shipments.routes.ts. */
  storageProvider?: StorageProvider;
  notificationsClient?: NotificationsClient;
  alertNotifier?: AlertNotifier;
  /** Reloj de la ventana de 7 días (ADR-054), solo tests. */
  now?: () => Date;
}

export function buildDisputesService(
  app: FastifyInstance,
  opts: DisputesRoutesOptions = {},
): DisputesService {
  return createDisputesService({
    shipmentRepository: createShipmentRepository(app.db),
    disputeRepository: createDisputeRepository(app.db),
    storageProvider: opts.storageProvider ?? createStorageProvider(app.config),
    redis: app.redis,
    notificationsClient:
      opts.notificationsClient ?? createNotificationsClient(app.config),
    alertNotifier:
      opts.alertNotifier ?? createAlertNotifier(app.config, app.log),
    logger: app.log,
    ...(opts.now ? { now: opts.now } : {}),
  });
}

const errors = {
  400: disputesSchemas.errorResponse,
  401: disputesSchemas.errorResponse,
  403: disputesSchemas.errorResponse,
  404: disputesSchemas.errorResponse,
  409: disputesSchemas.errorResponse,
};

/**
 * MOVO-334 (ADR-054): rutas que cuelgan de un envío (prefijo `/shipments`, mismo criterio que
 * ratings/handshake): apertura de la disputa y presign de sus fotos.
 */
export async function shipmentDisputeRoutes(
  app: FastifyInstance,
  opts: DisputesRoutesOptions,
) {
  const service = buildDisputesService(app, opts);

  app.post(
    "/:id/disputes/photos/presign",
    {
      schema: {
        summary: "URL de subida para una foto de evidencia de una disputa",
        description:
          "MOVO-334: cualquiera de las tres partes del envío. La key queda bajo " +
          "`shipments/{id}/disputes/{userId}/` y se asocia al abrir la disputa o al cargar un " +
          "descargo (`photoKeys`). Si nunca se asocia, el sweep de fotos huérfanas la borra.",
        tags: ["disputes"],
        params: disputesSchemas.shipmentIdParam,
        body: disputesSchemas.presignPhotoBody,
        response: { 200: disputesSchemas.presignPhotoResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as {
        contentType: string;
        contentLength: number;
      };
      return service.presignPhoto({ shipmentId: id, callerId, ...body });
    },
  );

  app.post(
    "/:id/disputes",
    {
      schema: {
        summary: "Abrir una disputa sobre un envío",
        description:
          "MOVO-334: el emisor, el receptor o el transportista (cualquier otro: 403). Estados: " +
          "`in_transit`, o `delivered`/`completed` dentro de los 7 días desde el handshake de " +
          "entrega (ADR-054). 422 DISPUTE_NOT_ALLOWED fuera de esos estados, " +
          "DISPUTE_WINDOW_EXPIRED pasada la ventana; 409 DISPUTE_ALREADY_OPEN " +
          "(`details.disputeId`) si ya hay una abierta. El envío pasa a `disputed`; no libera " +
          "ni captura el hold. Avisa por push a las tres partes y alerta al equipo.",
        tags: ["disputes"],
        params: disputesSchemas.shipmentIdParam,
        body: disputesSchemas.openDisputeBody,
        response: {
          201: disputesSchemas.disputeResponse,
          ...errors,
          422: disputesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as {
        reason: DisputeReason;
        description: string;
        photoKeys?: string[];
      };
      const dispute = await service.openDispute({
        shipmentId: id,
        callerId,
        reason: body.reason,
        description: body.description,
        photoKeys: body.photoKeys ?? [],
      });
      reply.code(201);
      return dispute;
    },
  );
}

/** MOVO-334: expediente y descargos (prefijo propio `/disputes`, mismo criterio que `/offers`). */
export async function disputeRoutes(
  app: FastifyInstance,
  opts: DisputesRoutesOptions,
) {
  const service = buildDisputesService(app, opts);

  app.get(
    "/:disputeId",
    {
      schema: {
        summary: "Detalle de una disputa",
        description:
          "MOVO-334: solo para las partes del envío. Expediente con la apertura, los descargos y " +
          "las fotos (URLs de lectura de TTL corto), sin notas internas del admin.",
        tags: ["disputes"],
        params: disputesSchemas.disputeIdParam,
        response: { 200: disputesSchemas.disputeResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { disputeId } = request.params as { disputeId: string };
      return service.getDispute(disputeId, callerId);
    },
  );

  app.post(
    "/:disputeId/statements",
    {
      schema: {
        summary: "Cargar un descargo o ampliar la evidencia",
        description:
          "MOVO-334: mientras la disputa esté abierta, cada parte que no la abrió carga un " +
          "descargo y quien la abrió amplía su evidencia, una vez cada uno. En una disputa del " +
          "sistema las tres partes cargan descargo. 409 DISPUTE_STATEMENT_ALREADY_SUBMITTED en " +
          "un segundo intento, DISPUTE_NOT_OPEN si ya se resolvió.",
        tags: ["disputes"],
        params: disputesSchemas.disputeIdParam,
        body: disputesSchemas.statementBody,
        response: {
          201: disputesSchemas.disputeResponse,
          ...errors,
          422: disputesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const callerId = requireUserIdFromHeader(request);
      const { disputeId } = request.params as { disputeId: string };
      const body = request.body as { text: string; photoKeys?: string[] };
      const dispute = await service.addStatement({
        disputeId,
        callerId,
        text: body.text,
        photoKeys: body.photoKeys ?? [],
      });
      reply.code(201);
      return dispute;
    },
  );
}
