import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  ADMIN_DISPUTE_SORTS,
  AdminDisputeAttribution,
  AdminDisputeCounts,
  AdminDisputeDetail,
  AdminDisputeHandshakeEvent,
  AdminDisputePartyHistory,
  AdminDisputeSort,
  AdminDisputePage,
  AdminDisputeResolutionPreview,
  AdminDisputeRow,
  AdminDisputeTrace,
  ApiError,
  DISPUTE_OUTCOMES,
  DISPUTE_PARTIAL_PRESETS,
  DISPUTE_REASONING_MAX_LENGTH,
  DISPUTE_REASONING_MIN_LENGTH,
  DisputeOutcome,
  DisputeReason,
  DisputeStatus,
  InternalResolveDisputeRequest,
  ResolveDisputeResponse,
  ShipmentParties,
  shipmentConfirmationCode,
} from "@movo/shared";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import {
  createDisputeRepository,
  DisputeListItem,
  InvalidDisputeCursorError,
} from "../../repositories/dispute-repository";
import { createPositionRepository } from "../../repositories/position-repository";
import { createPickupEvidenceRepository } from "../../repositories/pickup-evidence-repository";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { PaymentsClient } from "../../adapters/payments-client";
import { createAppPaymentsClient } from "../../adapters/simulated-payments-client";
import { AlertNotifier, createAlertNotifier } from "../../adapters/alert-notifier";
import { createStorageProvider, StorageProvider } from "../../adapters/storage-provider";
import { createDisputesService } from "../disputes/disputes.service";
import { createDisputeResolutionService } from "./dispute-resolution.service";

export interface AdminDisputesRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests, mismo criterio que `adminInternalRoutes`. */
  storageProvider?: StorageProvider;
  notificationsClient?: NotificationsClient;
  paymentsClient?: PaymentsClient;
  alertNotifier?: AlertNotifier;
}

const uuid = { type: "string", format: "uuid" } as const;
const idParam = { type: "object", required: ["id"], properties: { id: uuid } } as const;

const listQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: Object.values(DisputeStatus) },
    reason: { type: "string", enum: Object.values(DisputeReason) },
    outcome: { type: "string", enum: [...DISPUTE_OUTCOMES] },
    q: { type: "string", maxLength: 100 },
    city: { type: "string", maxLength: 100 },
    sort: { type: "string", enum: [...ADMIN_DISPUTE_SORTS] },
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    cursor: { type: "string", maxLength: 64 },
  },
} as const;

const resolveBody = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "reasoning", "adminId", "adminName"],
  properties: {
    outcome: { type: "string", enum: [...DISPUTE_OUTCOMES] },
    reasoning: { type: "string", minLength: DISPUTE_REASONING_MIN_LENGTH, maxLength: DISPUTE_REASONING_MAX_LENGTH + 200 },
    percentage: { type: "integer", enum: [...DISPUTE_PARTIAL_PRESETS] },
    amountArs: { type: "number", exclusiveMinimum: 0, maximum: 10_000_000 },
    adminId: uuid,
    adminName: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/**
 * MOVO-337: disputas para el panel. Internas (sin ruta en el gateway, ADR-010): `svc-admin` exige el rol admin,
 * aplica la regla de conflicto de interés y deja la bitácora. Las lecturas de otros bloques del expediente
 * (fotos de retiro y entrega, chat) salen de los endpoints de envío que ya existen (`/admin/shipments/:id/...`).
 */
export default async function adminDisputesRoutes(app: FastifyInstance, opts: AdminDisputesRoutesOptions) {
  const shipmentRepository = createShipmentRepository(app.db);
  const disputeRepository = createDisputeRepository(app.db);
  const positionRepository = createPositionRepository(app.db);
  const pickupEvidenceRepository = createPickupEvidenceRepository(app.db);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const alertNotifier = opts.alertNotifier ?? createAlertNotifier(app.config, app.log);
  const disputesService = createDisputesService({
    shipmentRepository,
    disputeRepository,
    storageProvider: opts.storageProvider ?? createStorageProvider(app.config),
    redis: app.redis,
    notificationsClient,
    alertNotifier,
    logger: app.log,
  });
  const resolution = createDisputeResolutionService({
    shipmentRepository,
    disputeRepository,
    paymentsClient: opts.paymentsClient ?? createAppPaymentsClient(app),
    notificationsClient,
    alertNotifier,
    redis: app.redis,
    logger: app.log,
  });

  function toRow({ dispute, shipment, names, statusAtOpen }: DisputeListItem): AdminDisputeRow {
    return {
      id: dispute.id,
      shipmentId: shipment.id,
      shipmentCode: shipmentConfirmationCode(shipment.id),
      status: dispute.status,
      reason: dispute.reason,
      openedByRole: dispute.openedByRole,
      openedAt: dispute.openedAt.toISOString(),
      shipmentStatusAtOpen: statusAtOpen,
      shipmentStatus: shipment.status,
      sender: { id: shipment.senderId, name: names.sender },
      carrier: shipment.carrierId ? { id: shipment.carrierId, name: names.carrier } : null,
      receiver: { id: shipment.receiverId, name: names.receiver },
      outcome: dispute.resolution?.outcome ?? null,
      pickupCity: shipment.pickupCity,
    };
  }

  /** Una entrada por parte que es una persona; el receptor no gana ni pierde, pero cuenta lo que abrió y lo que tiene abierto. */
  async function buildPartyHistory({ shipment }: DisputeListItem): Promise<AdminDisputePartyHistory[]> {
    const parties: Array<{ userId: string; role: AdminDisputePartyHistory["role"] }> = [
      { userId: shipment.senderId, role: "sender" },
      ...(shipment.carrierId ? [{ userId: shipment.carrierId, role: "carrier" as const }] : []),
      { userId: shipment.receiverId, role: "receiver" },
    ];
    const history = new Map(
      (await disputeRepository.partyHistory([...new Set(parties.map((party) => party.userId))])).map((entry) => [
        entry.userId,
        entry,
      ]),
    );
    return parties.map(({ userId, role }) => ({
      userId,
      role,
      opened: history.get(userId)?.opened ?? 0,
      lost: history.get(userId)?.lost ?? 0,
      open: history.get(userId)?.open ?? 0,
    }));
  }

  /**
   * DD-052: en una disputa de sistema, lo que decidió el barrido. `pickup_no_show` solo se abre cuando
   * `attributePickupMiss` dio `carrier_arrived`, así que el atribuido es el transportista y la llegada es la prueba;
   * `transit_anomaly` se abre por demora en tránsito, también del lado del transportista. Solo agregados: la traza de
   * posiciones de la ventana del retiro no se guarda.
   */
  async function buildAttribution({ dispute, shipment }: DisputeListItem): Promise<AdminDisputeAttribution | null> {
    if (dispute.reason !== DisputeReason.PICKUP_NO_SHOW && dispute.reason !== DisputeReason.TRANSIT_ANOMALY) return null;
    const base = {
      reason: dispute.reason,
      attributedTo: "carrier" as const,
      summary: dispute.description,
      sweptAt: dispute.openedAt.toISOString(),
    };
    if (dispute.reason === DisputeReason.PICKUP_NO_SHOW) {
      const evidence = await pickupEvidenceRepository.findDetail(shipment.id);
      return {
        ...base,
        lastPingAt: iso(evidence?.updatedAt),
        positions: evidence?.arrival
          ? [{ ...evidence.arrival, capturedAt: evidence.arrival.capturedAt.toISOString(), class: "arrival" }]
          : [],
        farPositionsInWindow: evidence?.farPositionsInWindow ?? 0,
        grayPositionsInWindow: evidence?.grayPositionsInWindow ?? 0,
      };
    }
    return {
      ...base,
      lastPingAt: iso(await positionRepository.findLastCustodyCapturedAt(shipment.id)),
      positions: [],
      farPositionsInWindow: 0,
      grayPositionsInWindow: 0,
    };
  }

  async function requireItem(id: string): Promise<DisputeListItem> {
    const item = await disputeRepository.findListItem(id);
    if (!item) throw new ApiError(404, "DISPUTE_NOT_FOUND", "Disputa no encontrada.");
    return item;
  }

  app.get(
    "/admin/disputes",
    { schema: { hide: true, querystring: listQuery } },
    async (request: FastifyRequest): Promise<AdminDisputePage> => {
      const query = request.query as {
        status?: DisputeStatus;
        reason?: DisputeReason;
        outcome?: DisputeOutcome;
        q?: string;
        city?: string;
        sort?: AdminDisputeSort;
        from?: string;
        to?: string;
        limit: number;
        cursor?: string;
      };
      const search = {
        ...(query.reason && { reason: query.reason }),
        ...(query.outcome && { outcome: query.outcome }),
        ...(query.q && { q: query.q }),
        ...(query.city && { city: query.city }),
        ...(query.from && { from: new Date(query.from) }),
        ...(query.to && { to: new Date(query.to) }),
      };
      try {
        const [page, statusCounts] = await Promise.all([
          disputeRepository.list({
            ...search,
            ...(query.status && { status: query.status }),
            ...(query.sort && { sort: query.sort }),
            limit: query.limit,
            ...(query.cursor && { cursor: query.cursor }),
          }),
          disputeRepository.statusCounts(search),
        ]);
        return { items: page.items.map(toRow), nextCursor: page.nextCursor, statusCounts };
      } catch (err) {
        if (err instanceof InvalidDisputeCursorError) {
          throw new ApiError(400, "VALIDATION_FAILED", "Cursor inválido.");
        }
        throw err;
      }
    },
  );

  // MOVO-341: contadores del menú lateral y la home. Sin filtros.
  app.get(
    "/admin/disputes/counts",
    { schema: { hide: true } },
    async (): Promise<AdminDisputeCounts> => disputeRepository.counts(),
  );

  app.get(
    "/admin/disputes/:id",
    { schema: { hide: true, params: idParam } },
    async (request: FastifyRequest): Promise<AdminDisputeDetail> => {
      const { id } = request.params as { id: string };
      const item = await requireItem(id);
      const [detail, partyHistory, attribution] = await Promise.all([
        disputesService.getDisputeAsAdmin(id),
        buildPartyHistory(item),
        buildAttribution(item),
      ]);
      const stored = item.dispute.resolution;
      return {
        ...toRow(item),
        description: detail.description,
        photos: detail.photos,
        statements: detail.statements,
        resolution: stored && {
          outcome: stored.outcome,
          reasoning: stored.reasoning,
          percentage: stored.percentage,
          carrierAmountArs: stored.carrierAmountArs,
          senderAmountArs: stored.senderAmountArs,
          paymentAction: stored.paymentAction,
          resolvedBy: stored.resolvedBy,
          resolvedAt: iso(stored.resolvedAt),
        },
        partyHistory,
        attribution,
      };
    },
  );

  // Las partes del envío, para la regla de conflicto de interés de `svc-admin`.
  app.get(
    "/admin/disputes/:id/parties",
    { schema: { hide: true, params: idParam } },
    async (request: FastifyRequest): Promise<ShipmentParties & { shipmentId: string }> => {
      const { id } = request.params as { id: string };
      const item = await requireItem(id);
      const parties = await shipmentRepository.findParties(item.shipment.id);
      if (!parties) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      return { ...parties, shipmentId: item.shipment.id };
    },
  );

  app.get(
    "/admin/disputes/:id/handshake",
    { schema: { hide: true, params: idParam } },
    async (request: FastifyRequest): Promise<AdminDisputeHandshakeEvent[]> => {
      const { id } = request.params as { id: string };
      const item = await requireItem(id);
      const events = await app.db.handshakeEvent.findMany({
        where: { shipmentId: item.shipment.id },
        orderBy: { createdAt: "asc" },
      });
      return events.map((event) => ({
        id: event.id,
        stage: event.stage,
        actorId: event.actorId,
        counterpartyId: event.counterpartyId,
        distanceM: event.distanceM.toNumber(),
        createdAt: event.createdAt.toISOString(),
      }));
    },
  );

  // La traza que se guarda con custodia (DD-023): desde el retiro hasta la entrega. Vacía si nunca hubo retiro o ya se purgó.
  app.get(
    "/admin/disputes/:id/trace",
    { schema: { hide: true, params: idParam } },
    async (request: FastifyRequest): Promise<AdminDisputeTrace> => {
      const { id } = request.params as { id: string };
      const item = await requireItem(id);
      const positions = await positionRepository.listCustodyTrace(item.shipment.id);
      return {
        available: positions.length > 0,
        points: positions.map((position) => ({
          lat: position.lat,
          lng: position.lng,
          accuracyM: position.accuracyM,
          capturedAt: position.capturedAt.toISOString(),
          mocked: position.mocked,
        })),
      };
    },
  );

  app.get(
    "/admin/disputes/:id/resolution-preview",
    { schema: { hide: true, params: idParam } },
    async (request: FastifyRequest): Promise<AdminDisputeResolutionPreview> => {
      const { id } = request.params as { id: string };
      return resolution.preview(id);
    },
  );

  app.post(
    "/admin/disputes/:id/resolve",
    { schema: { hide: true, params: idParam, body: resolveBody } },
    async (request: FastifyRequest): Promise<ResolveDisputeResponse> => {
      const { id } = request.params as { id: string };
      return resolution.resolve(id, request.body as InternalResolveDisputeRequest);
    },
  );
}
