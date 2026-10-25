import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import {
  AdminBlock,
  AdminShipmentDetail,
  blockedTransitionReason,
  ChangeShipmentStatusRequest,
  ChangeShipmentStatusResponse,
  FORCE_STATUS_REASON_MIN_LENGTH,
  forcedTransitionFriction,
  getForcedTransition,
  getForcedTransitionDetails,
  normalizeConfirmationCode,
  shipmentConfirmationCode,
  ShipmentStatus,
  ShipmentStatusOptions,
  StepUpChallenge,
  StepUpRequest,
  StepUpToken,
  StepUpVerifyRequest,
  AdminChatPage,
  AdminShipmentDetailResponse,
  AdminShipmentPage,
  AdminShipmentPartyCard,
  AdminShipmentPayment,
  AdminShipmentTracking,
  ApiError,
  ChatParticipantRole,
} from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { requireAdmin } from "../../utils/require-admin";
import { consumeRateLimit } from "../../utils/rate-limit";
import { createStatusChangeRecords } from "./status-change-records";
import { shipmentsSchemas } from "./shipments.schema";

/**
 * Un bloque del detalle que vive en otro servicio: si ese servicio no responde, el bloque viene en
 * `null` con su causa y el resto del detalle se devuelve igual (MOVO-325, AC9).
 */
async function block<T>(load: () => Promise<T>): Promise<AdminBlock<T>> {
  try {
    return { data: await load(), error: null };
  } catch (error) {
    if (error instanceof ApiError) return { data: null, error: { code: error.code, message: error.message } };
    return { data: null, error: { code: "BLOCK_UNAVAILABLE", message: "No se pudo obtener este bloque." } };
  }
}

/**
 * MOVO-325 (backend de MOVO-33): envíos para el panel. `svc-shipments` es el dueño de los datos
 * (endpoints internos `/internal/admin/shipments*`); acá se exige el rol admin y se completa el
 * detalle con `svc-users` (partes) y `svc-payments` (pago). Son lecturas: sin bitácora ni regla de
 * conflicto de interés (AC9 de MOVO-33).
 */
export default async function shipmentsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const errors = {
    400: shipmentsSchemas.errorResponse,
    401: shipmentsSchemas.errorResponse,
    403: shipmentsSchemas.errorResponse,
    404: shipmentsSchemas.errorResponse,
    502: shipmentsSchemas.errorResponse,
  };

  const notFound = () => new ApiError(404, "NOT_FOUND", "Envío no encontrado.");

  app.get(
    "/shipments",
    {
      schema: {
        tags: ["admin"],
        summary: "Envíos de la plataforma",
        description:
          "Por defecto los activos (todos los no terminales, incluidos `awaiting_receiver_confirmation` y " +
          "`rejected_by_receiver`); `status` o `group` piden otros, cerrados incluidos. Ordenado por último " +
          "cambio de estado, paginado por cursor. `q` busca por código, nombre de cualquiera de las partes y " +
          "dirección, sin tildes ni mayúsculas; `city` es la ciudad del retiro; `from`/`to` acotan el último " +
          "cambio de estado. `counts` trae el total de cada pestaña con los mismos filtros de búsqueda (sin " +
          "`group` ni `status`); `all` son los activos.",
        querystring: shipmentsSchemas.listQuery,
        response: { 200: shipmentsSchemas.listResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminShipmentPage> => {
      requireAdmin(request);
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(request.query as Record<string, string | number | boolean | undefined>)) {
        if (value !== undefined) query.set(key, String(value));
      }
      return app.shipmentsClient.listAdminShipments(query, { requestId: request.requestId });
    },
  );

  app.get(
    "/shipments/:id",
    {
      schema: {
        tags: ["admin"],
        summary: "Detalle completo de un envío",
        description:
          "El envío y sus bloques: eventos, fotos (URL firmada de vida corta) y ofertas (todas, con el desglose " +
          "del precio) de `svc-shipments`, pago de " +
          "`svc-payments` y partes con verificación y reputación de `svc-users`. Un bloque que no se pudo " +
          "obtener viene con `data: null` y su `error`, sin tumbar el resto. `payment.data` es `null` sin error " +
          "si nunca se intentó el pago.",
        params: shipmentsSchemas.idParam,
        response: { 200: shipmentsSchemas.detailResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminShipmentDetailResponse> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const ctx: RequestContext = { requestId: request.requestId };

      const shipment = await app.shipmentsClient.getAdminShipment(id, ctx);
      if (!shipment) throw notFound();

      const [events, photos, offers, payment, parties] = await Promise.all([
        block(async () => (await app.shipmentsClient.getAdminShipmentEvents(id, ctx)) ?? []),
        block(async () => (await app.shipmentsClient.getAdminShipmentPhotos(id, ctx)) ?? []),
        block(async () => (await app.shipmentsClient.getAdminShipmentOffers(id, ctx)) ?? []),
        block<AdminShipmentPayment>(() => app.paymentsClient.findHoldByShipment(id, ctx)),
        block(async (): Promise<AdminShipmentPartyCard[]> => {
          // Una persona puede cumplir dos roles (p. ej. emisor y receptor): una ficha por rol.
          const roles: Array<[ChatParticipantRole, string]> = [["sender", shipment.sender.id]];
          if (shipment.carrier) roles.push(["carrier", shipment.carrier.id]);
          roles.push(["receiver", shipment.receiver.id]);
          const cards = await app.usersClient.getPartyCards([...new Set(roles.map(([, userId]) => userId))], ctx);
          return roles.flatMap(([role, userId]) => {
            const card = cards.find((candidate) => candidate.id === userId);
            return card ? [{ ...card, role }] : [];
          });
        }),
      ]);

      return { shipment, events, photos, offers, payment, parties };
    },
  );

  app.get(
    "/shipments/:id/chat/messages",
    {
      schema: {
        tags: ["admin"],
        summary: "Chat del envío en solo lectura",
        description:
          "Todo el hilo del más reciente al más antiguo, con el contenido sin ocultar por bloqueos ni por el " +
          "inicio de la última asignación (ADR-040: es evidencia). Cada mensaje trae `moderated` y el rol de su " +
          "autor; `reports` dice quién reportó la conversación; `partiesAccess` si las partes pueden escribir " +
          "(`open`), solo leer (`read_only`) o ya no hay conversación (`closed`); `events` son los eventos del envío para intercalar por fecha.",
        params: shipmentsSchemas.idParam,
        querystring: shipmentsSchemas.chatQuery,
        response: { 200: shipmentsSchemas.chatResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminChatPage> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(request.query as Record<string, string | number | undefined>)) {
        if (value !== undefined) query.set(key, String(value));
      }
      const page = await app.shipmentsClient.getAdminShipmentChat(id, query, { requestId: request.requestId });
      if (!page) throw notFound();
      return page;
    },
  );

  app.get(
    "/shipments/:id/tracking",
    {
      schema: {
        tags: ["admin"],
        summary: "Seguimiento del envío para el mapa",
        description:
          "Ruta planificada, traza y, con el envío en camino, última posición y métricas (velocidad promedio de " +
          "5 min, km restantes, % y ETA). La posición solo se ve con el transportista en viaje (`live`). Sin un " +
          "ping reciente, `signalLost` con la hora del último y sin velocidad ni ETA. El panel lo pide por " +
          "polling cada `pollIntervalSeconds` (MOVO-327); la respuesta no se cachea.",
        params: shipmentsSchemas.idParam,
        response: { 200: shipmentsSchemas.trackingResponse, ...errors },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<AdminShipmentTracking> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const tracking = await app.shipmentsClient.getAdminShipmentTracking(id, { requestId: request.requestId });
      if (!tracking) throw notFound();
      reply.header("Cache-Control", "no-store");
      return tracking;
    },
  );

  // MOVO-332 (ADR-055): cambio de estado de un envío desde el panel. La lógica de transición es de
  // `svc-shipments`; acá van la regla de conflicto, la bitácora, el segundo factor y los límites.
  const ctxOf = (request: FastifyRequest): RequestContext => ({ requestId: request.requestId });

  // Por admin y por envío (AC8): corta a quien reintenta en loop o a dos admins pisándose el mismo envío.
  const STATUS_CHANGE_ADMIN_LIMIT = { max: 10, windowSeconds: 60 };
  const STATUS_CHANGE_SHIPMENT_LIMIT = { max: 5, windowSeconds: 60 };
  const records = createStatusChangeRecords(app.redis, app.log);

  /**
   * Un 429 también es un intento que merece rastro (si no, un admin que insiste en loop no deja nada), pero una fila
   * por cada rechazo inundaría la bitácora, que es de solo agregar: se deja UNA por admin y envío por ventana.
   */
  async function auditRateLimited(
    request: FastifyRequest,
    adminId: string,
    shipmentId: string,
    body: ChangeShipmentStatusRequest,
    error: ApiError,
  ): Promise<void> {
    const first = await app.redis.set(`admin-status-change:limited:${adminId}:${shipmentId}`, "1", "EX", 60, "NX");
    if (first !== "OK") return;
    await app.audit
      .runAdminAction(
        {
          adminId,
          action: "shipment.status_change",
          target: { type: "shipment", id: shipmentId },
          reason: body.reason.trim(),
          context: { from: body.expectedStatus, to: body.targetStatus, idempotencyKey: body.idempotencyKey, rateLimited: true },
          requestId: request.requestId,
        },
        async () => {
          throw error;
        },
      )
      .catch(() => undefined);
  }

  app.get(
    "/shipments/:id/status-options",
    {
      schema: {
        tags: ["admin"],
        summary: "A qué estados se puede cambiar un envío",
        description:
          "Desde el estado actual: `options` son los destinos que permite la matriz de `@movo/shared` (ADR-055), con " +
          "su riesgo, qué se ejecuta, a quién se avisa y si exigen el código del envío tipeado (`requiresTypedCode`) o " +
          "un segundo factor (`requiresStepUp`); `blocked` son los demás, con su motivo. `kind` es `manual` si es una " +
          "transición normal hecha por un admin y `forced` si se ejecuta con efectos distintos (sin penalidad). El " +
          "panel no calcula nada: `svc-shipments` vuelve a validar el pedido.",
        params: shipmentsSchemas.idParam,
        response: { 200: shipmentsSchemas.statusOptionsResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<ShipmentStatusOptions> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const shipment = await app.shipmentsClient.getAdminShipment(id, ctxOf(request));
      if (!shipment) throw notFound();

      const current = shipment.status as ShipmentStatus;
      const options: ShipmentStatusOptions["options"] = [];
      const blocked: ShipmentStatusOptions["blocked"] = [];
      for (const target of Object.values(ShipmentStatus)) {
        if (target === current) continue;
        const details = getForcedTransitionDetails(current, target);
        if (!details) {
          blocked.push({ targetStatus: target, reason: blockedTransitionReason(current, target) });
          continue;
        }
        const friction = forcedTransitionFriction(details);
        options.push({
          targetStatus: target,
          kind: details.kind,
          risk: details.risk,
          effects: details.effects,
          notifies: details.notifies,
          checks: details.checks,
          irreversible: details.irreversible,
          requiresTypedCode: friction.typedCode,
          requiresStepUp: friction.stepUp,
        });
      }
      return { current, code: shipmentConfirmationCode(id), options, blocked };
    },
  );

  app.post(
    "/step-up",
    {
      schema: {
        tags: ["admin"],
        summary: "Pedir el segundo factor de un cambio de estado",
        description:
          "Manda un código de 6 dígitos al email del admin, de un solo uso, con vigencia de " +
          "`expiresInSeconds` y atado a la acción (este admin, este envío y este destino). Máximo 5 pedidos cada " +
          "15 minutos. El envío tiene que existir y la transición estar en la matriz y exigir segundo factor " +
          "(`requiresStepUp` de `status-options`): si no, 404, 422 `TRANSITION_NOT_ALLOWED` o 400. Se canjea por un " +
          "`stepUpToken` en `POST /admin/step-up/verify`.",
        body: shipmentsSchemas.stepUpBody,
        response: {
          200: shipmentsSchemas.stepUpChallengeResponse,
          422: shipmentsSchemas.errorResponse,
          429: shipmentsSchemas.errorResponse,
          ...errors,
        },
      },
    },
    async (request: FastifyRequest): Promise<StepUpChallenge> => {
      const adminId = requireAdmin(request);
      const body = request.body as StepUpRequest;
      const ctx = ctxOf(request);
      // No se manda un email por cualquier par: el envío tiene que existir y la transición, estar en la matriz
      // y exigir segundo factor. (El 5 pedidos por 15 minutos de svc-users sigue siendo el freno de fondo.)
      const shipment = await app.shipmentsClient.getAdminShipment(body.shipmentId, ctx);
      if (!shipment) throw notFound();
      const from = shipment.status as ShipmentStatus;
      const to = body.targetStatus as ShipmentStatus;
      const cell = getForcedTransition(from, to);
      if (!cell) {
        const reason = blockedTransitionReason(from, to);
        throw new ApiError(422, "TRANSITION_NOT_ALLOWED", reason, { reason });
      }
      if (!forcedTransitionFriction(cell).stepUp) {
        throw new ApiError(400, "VALIDATION_FAILED", "Esta transición no exige un segundo factor.");
      }
      return app.usersClient.requestStepUp(adminId, body, ctx);
    },
  );

  app.post(
    "/step-up/verify",
    {
      schema: {
        tags: ["admin"],
        summary: "Verificar el segundo factor de un cambio de estado",
        description:
          "Canjea el código por un `stepUpToken` de un solo uso para esa misma acción. Cualquier fallo (código " +
          "erróneo, vencido, usado, de otro envío o destino) es `401 STEP_UP_INVALID`, sin distinguir el motivo. " +
          "Tras 5 errores el admin queda bloqueado 15 minutos (429).",
        body: shipmentsSchemas.stepUpVerifyBody,
        response: { 200: shipmentsSchemas.stepUpTokenResponse, 429: shipmentsSchemas.errorResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<StepUpToken> => {
      const adminId = requireAdmin(request);
      return app.usersClient.verifyStepUp(adminId, request.body as StepUpVerifyRequest, ctxOf(request));
    },
  );

  app.post(
    "/shipments/:id/status",
    {
      schema: {
        tags: ["admin"],
        summary: "Cambiar el estado de un envío",
        description:
          "Regla de conflicto de interés (403 `ADMIN_CONFLICT_OF_INTEREST` si el admin es parte del envío), " +
          "bitácora `shipment.status_change` (incluidos los rechazos) y llamada a `svc-shipments`, que ejecuta el " +
          "servicio de dominio de la transición, registra el evento y avisa a las partes. `reason` de al menos 20 " +
          "caracteres; `typedCode` (el código del envío) si el riesgo del destino es alto o crítico; `stepUpToken` si " +
          "la transición es forzada o crítica (`GET /admin/shipments/:id/status-options` lo indica). Los rechazos de " +
          "`svc-shipments` pasan con su código: `STATUS_CHANGED` (`details.currentStatus`), `TRANSITION_NOT_ALLOWED` " +
          "(`details.reason`), `HOLD_NOT_AUTHORIZED`, `FORCE_STATUS_EFFECT_FAILED`. Idempotente por `idempotencyKey`. " +
          "Máximo 10 cambios por minuto por admin y 5 por envío.",
        params: shipmentsSchemas.idParam,
        body: shipmentsSchemas.statusChangeBody,
        response: {
          200: shipmentsSchemas.statusChangeResponse,
          409: shipmentsSchemas.errorResponse,
          422: shipmentsSchemas.errorResponse,
          429: shipmentsSchemas.errorResponse,
          ...errors,
        },
      },
    },
    async (request: FastifyRequest): Promise<ChangeShipmentStatusResponse> => {
      const adminId = requireAdmin(request);
      const { id } = request.params as { id: string };
      const body = request.body as ChangeShipmentStatusRequest;
      const ctx = ctxOf(request);

      const reason = body.reason.trim();
      const from = body.expectedStatus as ShipmentStatus;
      const to = body.targetStatus as ShipmentStatus;
      const cell = getForcedTransition(from, to);
      const friction = cell ? forcedTransitionFriction(cell) : null;

      // Reintento de una clave ya usada (doble clic, timeout): el cambio no se vuelve a validar ni a pedir el
      // segundo factor. Va antes del rate limit: un replay no es un intento nuevo.
      const previous = await records.read(adminId, id, body.idempotencyKey);
      if (previous && (previous.targetStatus !== body.targetStatus || previous.expectedStatus !== body.expectedStatus)) {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Esa clave de idempotencia ya se usó para otro cambio.");
      }
      if (previous?.state === "done" && previous.response) return { ...previous.response, replayed: true };
      // La llamada anterior no tuvo respuesta y pudo aplicarse: el segundo factor ya se gastó.
      const retryAfterUnknown = previous?.state === "unknown";
      const needsStepUp = friction?.stepUp === true && !retryAfterUnknown;

      try {
        await consumeRateLimit(app.redis, `admin-status-change:admin:${adminId}`, STATUS_CHANGE_ADMIN_LIMIT.max, STATUS_CHANGE_ADMIN_LIMIT.windowSeconds);
        await consumeRateLimit(app.redis, `admin-status-change:shipment:${id}`, STATUS_CHANGE_SHIPMENT_LIMIT.max, STATUS_CHANGE_SHIPMENT_LIMIT.windowSeconds);
      } catch (error) {
        if (error instanceof ApiError && error.code === "RATE_LIMIT_EXCEEDED") {
          await auditRateLimited(request, adminId, id, body, error);
        }
        throw error;
      }

      // Lo que resuelve la lectura previa y usa la acción.
      let adminName = "";
      const stepUpAction = () => ({ shipmentId: id, targetStatus: body.targetStatus, stepUpToken: body.stepUpToken as string });

      /** Gasta el token del segundo factor. Nunca tira: el cambio ya se aplicó (o no se sabe), no puede fallar por esto. */
      const spendStepUp = async () => {
        if (!needsStepUp) return;
        try {
          await app.usersClient.consumeStepUp(adminId, stepUpAction(), ctx);
        } catch (err) {
          request.log.warn({ err, event: "step_up_consume_failed", shipmentId: id }, "No se pudo gastar el token del segundo factor");
        }
      };

      return app.audit.runAdminAction(
        {
          adminId,
          action: "shipment.status_change",
          target: { type: "shipment", id },
          reason,
          // Los rechazos también dejan fila: de qué estado a cuál se intentó y con qué riesgo.
          context: {
            from,
            to,
            forced: cell?.kind === "forced",
            risk: cell?.risk ?? null,
            idempotencyKey: body.idempotencyKey,
            ...(retryAfterUnknown ? { retryAfterUnknown: true } : {}),
          },
          resolveContext: (result) => ({ replayed: result.replayed }),
          requestId: request.requestId,
          // Las validaciones corren después de la regla de conflicto y sin gastar el segundo factor (solo se comprueba):
          // un rechazo no quema el token, y como son lecturas quedan `failed` (nada se aplicó) aunque otro servicio no responda.
          precheck: async () => {
            if (reason.length < FORCE_STATUS_REASON_MIN_LENGTH) {
              throw new ApiError(400, "VALIDATION_FAILED", `El motivo tiene que tener al menos ${FORCE_STATUS_REASON_MIN_LENGTH} caracteres.`);
            }
            const shipment: AdminShipmentDetail | null = await app.shipmentsClient.getAdminShipment(id, ctx);
            if (!shipment) throw notFound();
            // Tras una llamada sin respuesta el envío puede estar ya en el destino: lo resuelve `svc-shipments` con la clave.
            if (!retryAfterUnknown && shipment.status !== body.expectedStatus) {
              throw new ApiError(409, "STATUS_CHANGED", "El estado del envío cambió mientras confirmabas.", {
                currentStatus: shipment.status,
              });
            }
            if (!cell || !friction) {
              const blockedReason = blockedTransitionReason(from, to);
              throw new ApiError(422, "TRANSITION_NOT_ALLOWED", blockedReason, { reason: blockedReason });
            }
            if (friction.typedCode && normalizeConfirmationCode(body.typedCode ?? "") !== shipmentConfirmationCode(id)) {
              throw new ApiError(422, "TYPED_CODE_MISMATCH", "El código del envío no coincide.");
            }
            if (needsStepUp) {
              if (!body.stepUpToken) {
                throw new ApiError(403, "STEP_UP_REQUIRED", "Este cambio exige confirmar con un código enviado a tu email.");
              }
              await app.usersClient.validateStepUp(adminId, stepUpAction(), ctx);
            }
            // Falla cerrado: svc-shipments pide el nombre del admin para el evento inmutable.
            const names = await app.usersClient.getUserNames([adminId], ctx);
            const name = names.find((candidate) => candidate.id === adminId)?.fullName;
            if (!name) throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "No se pudo identificar al admin.");
            adminName = name;
          },
        },
        async () => {
          try {
            const result = await app.shipmentsClient.forceShipmentStatus(
              id,
              {
                targetStatus: body.targetStatus,
                expectedStatus: body.expectedStatus,
                reason,
                adminId,
                adminName,
                idempotencyKey: body.idempotencyKey,
              },
              ctx,
            );
            // Recién ahora se gasta el token: con un rechazo de negocio (hold no autorizado, estado cambiado...) el
            // admin puede corregir y reintentar con el mismo código mientras no venza.
            await spendStepUp();
            await records.save(adminId, id, body.idempotencyKey, {
              state: "done",
              targetStatus: body.targetStatus,
              expectedStatus: body.expectedStatus,
              response: result,
            });
            return result;
          } catch (error) {
            // Sin respuesta de svc-shipments: pudo haberse aplicado. El token se gasta igual y el reintento no lo pide.
            if (error instanceof ApiError && error.code.endsWith("_SERVICE_UNAVAILABLE")) {
              await spendStepUp();
              await records.save(adminId, id, body.idempotencyKey, {
                state: "unknown",
                targetStatus: body.targetStatus,
                expectedStatus: body.expectedStatus,
              });
            }
            throw error;
          }
        },
      );
    },
  );
}
