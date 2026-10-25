import Fastify, { FastifyInstance } from "fastify";
import { ApiError } from "@movo/shared";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";
import realtimePlugin from "./plugins/realtime";
import errorHandlerPlugin from "./plugins/error-handler";
import receiverConfirmationSweepPlugin from "./plugins/receiver-confirmation-sweep";
import orphanPhotoSweepPlugin from "./plugins/orphan-photo-sweep";
import supportAttachmentSweepPlugin from "./plugins/support-attachment-sweep";
import pickupExpirySweepPlugin from "./plugins/pickup-expiry-sweep";
import carrierPositionPurgeSweepPlugin from "./plugins/carrier-position-purge-sweep";
import historyRetentionSweepPlugin from "./plugins/history-retention-sweep";
import tripExpirySweepPlugin from "./plugins/trip-expiry-sweep";
import pickupMissedSweepPlugin from "./plugins/pickup-missed-sweep";
import transitAnomalySweepPlugin from "./plugins/transit-anomaly-sweep";
import tripDepartureReminderSweepPlugin from "./plugins/trip-departure-reminder-sweep";
import fundingSweepPlugin from "./plugins/funding-sweep";
import settlementsPlugin from "./plugins/settlements";
import settlementSweepPlugin from "./plugins/settlement-sweep";
import settlementRoutes, { internalSettlementRoutes, SettlementRoutesOptions } from "./modules/settlements/settlements.routes";
import fundingRoutes, { internalFundingRoutes, FundingRoutesOptions } from "./modules/funding/funding.routes";
import shipmentsRoutes, { ShipmentsRoutesOptions } from "./modules/shipments/shipments.routes";
import ledgerOriginsRoutes from "./modules/shipments/ledger-origins.routes";
import offersRoutes, { OffersRoutesOptions } from "./modules/offers/offers.routes";
import ratingsRoutes, { internalRatingsRoutes, RatingsRoutesOptions } from "./modules/ratings/ratings.routes";
import tripsRoutes, { TripsRoutesOptions } from "./modules/trips/trips.routes";
import accountDeletionRoutes from "./modules/account-deletion/account-deletion.routes";
import mutualConnectionsRoutes from "./modules/mutual-connections/mutual-connections.routes";
import adminInternalRoutes from "./modules/admin-internal/admin-internal.routes";
import handshakeRoutes, { HandshakeRoutesOptions } from "./modules/handshake/handshake.routes";
import trackingRoutes, { TrackingRoutesOptions } from "./modules/tracking/tracking.routes";
import positionsRoutes, { PositionsRoutesOptions } from "./modules/positions/positions.routes";
import demoRoutes, { DemoRoutesOptions } from "./modules/demo/demo.routes";
import chatRoutes, { ChatRoutesOptions } from "./modules/chat/chat.routes";
import supportRoutes, { SupportRoutesOptions } from "./modules/support/support.routes";
import adminSupportRoutes, { AdminSupportRoutesOptions } from "./modules/admin-support/admin-support.routes";
import receiverTransfersRoutes, {
  ReceiverTransfersRoutesOptions,
  shipmentReceiverTransferRoutes,
} from "./modules/receiver-transfers/receiver-transfers.routes";
import { disputeRoutes, DisputesRoutesOptions, shipmentDisputeRoutes } from "./modules/disputes/disputes.routes";
import { ShipmentRepository } from "./repositories/shipment-repository";
import { UserDeletionClient, UsersClient } from "./adapters/users-client";
import { PaymentsClient } from "./adapters/payments-client";
import { StorageProvider } from "./adapters/storage-provider";
import { RoutesProvider } from "./adapters/routes-provider";
import { NotificationsClient } from "./adapters/notifications-client";
import { PricingClient } from "./adapters/pricing-client";
import { PricingLogisticsClient } from "./adapters/pricing-logistics-client";
import { FundsReleaseNotifier } from "./adapters/funds-release-notifier";
import { AlertNotifier } from "./adapters/alert-notifier";

export interface BuildAppOptions {
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado, mismo criterio que `smsProvider`/`diditClient`/`geocodingProvider`/
   * `storageProvider` en movo-svc-users. */
  usersClient?: UsersClient;
  /** Override solo para tests de integración — evita depender de un `movo-svc-payments`
   * real levantado (MOVO-116 bloqueo del transportista, MOVO-210 saga de pago), mismo criterio que `usersClient`. */
  paymentsClient?: PaymentsClient;
  /** Override solo para tests de integración — evita depender de un bucket real/
   * credenciales de AWS (MOVO-81). */
  storageProvider?: StorageProvider;
  /** Override solo para tests de integración — evita depender de credenciales reales
   * de Google (MOVO-123), mismo criterio que `usersClient`. */
  routesProvider?: RoutesProvider;
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado (MOVO-108/129), mismo criterio que `usersClient`. */
  notificationsClient?: NotificationsClient;
  /** Reloj del chat (MOVO-26), solo para probar el borde de las 24 h en tests. */
  chatNow?: () => Date;
  /** Agenda el resumen de avisos de una ráfaga de chat (MOVO-301); solo tests, para no esperar la ventana real. */
  chatSchedulePush?: (run: () => void, delayMs: number) => void;
  /** Reloj de las conversaciones de soporte (MOVO-320), solo tests. */
  supportNow?: () => Date;
  /** Agenda el resumen de avisos de una ráfaga de soporte (MOVO-320, ADR-046); solo tests. */
  supportSchedulePush?: (run: () => void, delayMs: number) => void;
  /** Override solo para tests de integración — evita depender de un
   * `movo-svc-pricing-logistics` real levantado (MOVO-82), mismo criterio que
   * `usersClient`. */
  pricingClient?: PricingClient;
  /** Override para habilitar/deshabilitar el barrido periódico en background (MOVO-130). */
  sweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de fotos huérfanas en background (MOVO-124). */
  orphanPhotoSweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de adjuntos de soporte huérfanos (MOVO-321). */
  supportAttachmentSweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de retiro vencido en background. */
  pickupExpirySweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de purga de posiciones GPS en
   * background (MOVO-202). */
  carrierPositionPurgeSweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar la purga de historial de envíos vencido (MOVO-230). */
  historyRetentionSweepEnabled?: boolean;
  /** Override solo para tests de integración -- evita depender de un `movo-svc-users` real
   * para las fechas de baja (MOVO-230), mismo criterio que `usersClient`. */
  userDeletionClient?: UserDeletionClient;
  /** Override para habilitar/deshabilitar el sweep de viajes declared vencidos en
   * background (MOVO-238). */
  tripExpirySweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de retiro no realizado (MOVO-258). */
  pickupMissedSweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de `in_transit` anómalo (MOVO-258). */
  transitAnomalySweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el recordatorio del día anterior al viaje (MOVO-240). */
  tripDepartureReminderSweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de la saga de asignación (MOVO-210). */
  fundingSweepEnabled?: boolean;
  /** MOVO-212: barrido de liquidaciones; solo corre con FUNDS_RELEASE_NOTIFIER=payments. */
  settlementSweepEnabled?: boolean;
  /** Override solo para tests de integración -- evita depender de una integración
   * real de liberación de fondos (MOVO-158, fuera de alcance de este ticket). */
  fundsReleaseNotifier?: FundsReleaseNotifier;
  /** Override solo para tests de integración -- cliente de pricing-logistics (MOVO-206 / MOVO-219). */
  pricingLogisticsClient?: PricingLogisticsClient;
  /** Override solo para tests -- canal de tiempo real (MOVO-201/ADR-022), evita
   * depender de Postgres real para probar el rechazo de una conexión WS. */
  shipmentRepository?: ShipmentRepository;
  /** Override solo para tests -- alerta al equipo al abrirse una disputa (MOVO-334). */
  alertNotifier?: AlertNotifier;
  /** Reloj de la ventana para abrir una disputa (MOVO-334, ADR-054), solo tests. */
  disputesNow?: () => Date;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  // MOVO-129: un body vacío con `content-type: application/json` (lo que manda cualquier
  // cliente HTTP que setee el header incondicionalmente) hace fallar al parser por defecto
  // con FST_ERR_CTP_EMPTY_JSON_BODY -- un 400 antes de llegar a la validación de schema.
  // Los endpoints de decisión del receptor se documentan como "body vacío", así que acá lo
  // tratamos como `null` y dejamos que el schema (`nullable: true`) decida.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body: string, done) => {
      if (body === "") {
        done(null, null);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        // `ApiError` y no un Error suelto: el error handler solo mapea al formato único
        // los `ApiError` y los de validación de AJV -- cualquier otro cae al 500 genérico.
        done(new ApiError(400, "VALIDATION_FAILED", "El body no es JSON válido."), undefined);
      }
    }
  );

  app.register(fastifyEnv, {
    schema: envSchema,
    dotenv: true,
    data: process.env,
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "movo-svc-shipments",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(errorHandlerPlugin);
  app.register(dbPlugin);
  app.register(redisPlugin);
  app.register(authPlugin);
  app.register(realtimePlugin);
  app.register(receiverConfirmationSweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.sweepEnabled !== undefined ? { enabled: opts.sweepEnabled } : {}),
  });
  app.register(orphanPhotoSweepPlugin, {
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.orphanPhotoSweepEnabled !== undefined ? { enabled: opts.orphanPhotoSweepEnabled } : {}),
  });
  app.register(supportAttachmentSweepPlugin, {
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.supportAttachmentSweepEnabled !== undefined ? { enabled: opts.supportAttachmentSweepEnabled } : {}),
  });
  app.register(pickupExpirySweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.pickupExpirySweepEnabled !== undefined ? { enabled: opts.pickupExpirySweepEnabled } : {}),
  });
  app.register(carrierPositionPurgeSweepPlugin, {
    ...(opts.carrierPositionPurgeSweepEnabled !== undefined
      ? { enabled: opts.carrierPositionPurgeSweepEnabled }
      : {}),
  });
  app.register(historyRetentionSweepPlugin, {
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.userDeletionClient ? { deletionClient: opts.userDeletionClient } : {}),
    ...(opts.historyRetentionSweepEnabled !== undefined ? { enabled: opts.historyRetentionSweepEnabled } : {}),
  });
  app.register(tripExpirySweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.tripExpirySweepEnabled !== undefined ? { enabled: opts.tripExpirySweepEnabled } : {}),
  });
  app.register(pickupMissedSweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    // MOVO-210: el barrido cancela envíos `assigned`/`assignment_pending` con hold vivo.
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
    ...(opts.pickupMissedSweepEnabled !== undefined ? { enabled: opts.pickupMissedSweepEnabled } : {}),
  });
  app.register(transitAnomalySweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.transitAnomalySweepEnabled !== undefined ? { enabled: opts.transitAnomalySweepEnabled } : {}),
  });
  app.register(tripDepartureReminderSweepPlugin, {
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.tripDepartureReminderSweepEnabled !== undefined
      ? { enabled: opts.tripDepartureReminderSweepEnabled }
      : {}),
  });
  app.register(fundingSweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
    ...(opts.fundingSweepEnabled !== undefined ? { enabled: opts.fundingSweepEnabled } : {}),
  });

  // MOVO-212: el service de liquidación se arma una sola vez (`app.settlements`) para el notifier del
  // handshake, el barrido y las rutas; tiene que registrarse antes que cualquiera de los tres.
  app.register(settlementsPlugin, {
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
  });
  // MOVO-212: reintenta la captura de los `delivered` sin cobrar (solo con el notifier real).
  app.register(settlementSweepPlugin, {
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
    ...(opts.settlementSweepEnabled !== undefined ? { enabled: opts.settlementSweepEnabled } : {}),
  });

  app.get("/health", async () => ({ status: "ok" }));

  const shipmentsRouteOpts: ShipmentsRoutesOptions = {
    prefix: "/shipments",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.routesProvider ? { routesProvider: opts.routesProvider } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.pricingClient ? { pricingClient: opts.pricingClient } : {}),
    ...(opts.pricingLogisticsClient ? { pricingLogisticsClient: opts.pricingLogisticsClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
  };
  app.register(shipmentsRoutes, shipmentsRouteOpts);
  app.register(ledgerOriginsRoutes, { prefix: "/internal" });

  // MOVO-210: pago del emisor (`GET`/`POST /shipments/:id/funding`) y aviso interno de
  // `svc-payments` cuando MP pierde un hold (`POST /internal/shipments/:id/hold-events`).
  const fundingRouteOpts: FundingRoutesOptions = {
    prefix: "/shipments",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
  };
  app.register(fundingRoutes, fundingRouteOpts);
  app.register(internalFundingRoutes, { ...fundingRouteOpts, prefix: "/internal" });

  // MOVO-144/145: prefijo propio, no anidado bajo /shipments, mismo criterio que
  // /addresses en el gateway.
  const offersRouteOpts: OffersRoutesOptions = {
    prefix: "/offers",
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    // MOVO-234: resuelve la ficha de vehículo del transportista para el Trip
    // auto-creado al aceptar una oferta sin viaje asociado.
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
  };
  app.register(offersRoutes, offersRouteOpts);

  // MOVO-146: montado con el mismo prefix "/shipments" que shipmentsRoutes -- rutas
  // "/shipments/:id/ratings"/"/shipments/:id/ratings/:rateeId", dominio propio (tabla
  // ratings) por eso vive en su propio módulo.
  const ratingsRouteOpts: RatingsRoutesOptions = {
    prefix: "/shipments",
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
  };
  app.register(ratingsRoutes, ratingsRouteOpts);

  // MOVO-161: viajes declarados por el transportista para matching geométrico de paquetes
  // compatibles por corredor ("Mis viajes", MOVO-18/162).
  const tripsRouteOpts: TripsRoutesOptions = {
    prefix: "/trips",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.pricingLogisticsClient ? { pricingLogisticsClient: opts.pricingLogisticsClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
  };
  app.register(tripsRoutes, tripsRouteOpts);

  // MOVO-134: consultado por movo-svc-users antes de aplicar una baja de cuenta.
  // Interno -- no se declara en gateway/src/config/routes-map.ts (mismo criterio que
  // /internal/notifications de movo-svc-users, MOVO-106).
  app.register(accountDeletionRoutes, { prefix: "/internal/account-deletion" });

  // MOVO-174: consultado por movo-svc-users para "conexiones mutuas" del perfil. Interno.
  app.register(mutualConnectionsRoutes, { prefix: "/internal" });

  // MOVO-288: partes de un envío o de un reporte de chat, para la regla de conflicto de
  // interés de movo-svc-admin. Interno.
  // MOVO-325: también listado, detalle, eventos, fotos y chat de los envíos para el panel.
  // MOVO-297: y los efectos de una sanción (retiro de actividad abierta y avisos).
  app.register(adminInternalRoutes, {
    prefix: "/internal",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
  });

  // MOVO-146 AC10: consultado por movo-svc-users para el agregado/últimas
  // calificaciones del perfil (MOVO-25). Interno, mismo criterio que accountDeletionRoutes.
  app.register(internalRatingsRoutes, { prefix: "/internal" });

  // MOVO-158: core del handshake criptográfico -- mismo prefix "/shipments" que
  // shipmentsRoutes/ratingsRoutes, dominio propio (tabla append-only handshake_events).
  const handshakeRouteOpts: HandshakeRoutesOptions = {
    prefix: "/shipments",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.fundsReleaseNotifier ? { fundsReleaseNotifier: opts.fundsReleaseNotifier } : {}),
    // MOVO-212: el notifier real captura el hold y avisa por push.
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
  };
  app.register(handshakeRoutes, handshakeRouteOpts);

  // MOVO-212 AC10: `GET /shipments/:id/settlement`, el pago del envío según el rol.
  const settlementRouteOpts: SettlementRoutesOptions = { prefix: "/shipments" };
  app.register(settlementRoutes, settlementRouteOpts);
  // MOVO-213: aviso interno de svc-payments (cobro demorado / acreditado por un reintento).
  app.register(internalSettlementRoutes, { prefix: "/internal" });

  // MOVO-201/ADR-022: canal de tiempo real (@fastify/websocket) -- mismo prefix
  // "/shipments" que shipmentsRoutes/handshakeRoutes. Reemplaza la PoC de MOVO-200 --
  // ver el aviso completo en tracking.routes.ts y docs/tracking/README.md.
  const trackingRouteOpts: TrackingRoutesOptions = {
    prefix: "/shipments",
    ...(opts.shipmentRepository ? { shipmentRepository: opts.shipmentRepository } : {}),
  };
  app.register(trackingRoutes, trackingRouteOpts);

  // MOVO-202: ingesta de posiciones GPS -- mismo prefix "/shipments" que
  // trackingRoutes (el canal de recepción que difunde lo que este módulo publica).
  const positionsRouteOpts: PositionsRoutesOptions = {
    prefix: "/shipments",
    ...(opts.shipmentRepository ? { shipmentRepository: opts.shipmentRepository } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
  };
  app.register(positionsRoutes, positionsRouteOpts);

  // MOVO-334 (ADR-054): apertura de disputas (`/shipments/:id/disputes`) y expediente/descargos
  // (`/disputes/:disputeId`, prefijo propio como `/offers`).
  const disputesRouteOpts: DisputesRoutesOptions = {
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.alertNotifier ? { alertNotifier: opts.alertNotifier } : {}),
    ...(opts.disputesNow ? { now: opts.disputesNow } : {}),
  };
  app.register(shipmentDisputeRoutes, { ...disputesRouteOpts, prefix: "/shipments" });
  app.register(disputeRoutes, { ...disputesRouteOpts, prefix: "/disputes" });

  // Juegos del sitio institucional (/juegos): autenticados por API key en el gateway
  // (prefijo /demo), no por JWT -- ver demo.routes.ts.
  const demoRouteOpts: DemoRoutesOptions = {
    prefix: "/demo",
    ...(opts.pricingClient ? { pricingClient: opts.pricingClient } : {}),
    ...(opts.pricingLogisticsClient ? { pricingLogisticsClient: opts.pricingLogisticsClient } : {}),
  };
  app.register(demoRoutes, demoRouteOpts);

  // MOVO-275 (ADR-038): transferencia de receptor. Pedirla y listarla cuelgan del envío
  // (prefijo "/shipments"); aceptar/rechazar/cancelar e invitaciones, de su prefijo propio.
  const receiverTransfersRouteOpts: ReceiverTransfersRoutesOptions = {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
  };
  app.register(shipmentReceiverTransferRoutes, { prefix: "/shipments", ...receiverTransfersRouteOpts });
  app.register(receiverTransfersRoutes, { prefix: "/receiver-transfers", ...receiverTransfersRouteOpts });

  // MOVO-26 (ADR-040): chat del envío -- se envía por HTTP, se recibe por WebSocket, mismo
  // prefijo "/shipments" (el gateway ya proxea HTTP y el upgrade de ese prefijo).
  const chatRouteOpts: ChatRoutesOptions = {
    prefix: "/shipments",
    ...(opts.shipmentRepository ? { shipmentRepository: opts.shipmentRepository } : {}),
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.chatNow ? { now: opts.chatNow } : {}),
    ...(opts.chatSchedulePush ? { schedulePush: opts.chatSchedulePush } : {}),
  };
  app.register(chatRoutes, chatRouteOpts);

  // MOVO-320 (ADR-051): soporte al usuario sobre el chat existente (mismo `ChatHub`, otra clave de sala). Prefijo
  // "/support": el gateway lo proxea (HTTP y upgrade) hacia este servicio.
  const supportRouteOpts: SupportRoutesOptions = {
    prefix: "/support",
    ...(opts.shipmentRepository ? { shipmentRepository: opts.shipmentRepository } : {}),
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.supportNow ? { now: opts.supportNow } : {}),
    ...(opts.supportSchedulePush ? { schedulePush: opts.supportSchedulePush } : {}),
  };
  app.register(supportRoutes, supportRouteOpts);

  // MOVO-322: el lado del agente de soporte, solo para svc-admin (red Docker interna, sin pasar por el gateway).
  const adminSupportRouteOpts: AdminSupportRoutesOptions = {
    prefix: "/internal/admin/support",
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.supportNow ? { now: opts.supportNow } : {}),
    ...(opts.supportSchedulePush ? { schedulePush: opts.supportSchedulePush } : {}),
  };
  app.register(adminSupportRoutes, adminSupportRouteOpts);

  return app;
}
