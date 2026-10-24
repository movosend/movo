export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  USERS_SERVICE_URL: string;
  PAYMENTS_SERVICE_URL: string;
  PRICING_SERVICE_URL: string;
  STORAGE_PROVIDER: "mock" | "s3";
  S3_BUCKET_NAME?: string;
  S3_REGION?: string;
  ROUTES_PROVIDER: "mock" | "google";
  GOOGLE_MAPS_API_KEY?: string;
  RECEIVER_CONFIRMATION_TIMEOUT_HOURS: number;
  RECEIVER_REDESIGNATION_TIMEOUT_HOURS: number;
  RECEIVER_TRANSFER_TIMEOUT_HOURS: number;
  RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES: number;
  RECEIVER_CONFIRMATION_SWEEP_ENABLED?: boolean;
  ORPHAN_PHOTO_RETENTION_HOURS: number;
  ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: number;
  ORPHAN_PHOTO_SWEEP_ENABLED?: boolean;
  REPUTATION_CONFIDENCE_CONSTANT: number;
  REPUTATION_DECAY_HALF_LIFE_DAYS: number;
  TRIP_DEFAULT_MAX_DETOUR_KM: number;
  PACKAGE_MAX_WEIGHT_KG: number;
  PACKAGE_MAX_SIDE_CM: number;
  PACKAGE_MAX_SIDES_SUM_CM: number;
  PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES: number;
  PICKUP_EXPIRY_SWEEP_ENABLED?: boolean;
  FUNDS_RELEASE_NOTIFIER: "console" | "payments";
  SETTLEMENT_SWEEP_INTERVAL_MINUTES: number;
  SETTLEMENT_SWEEP_GRACE_MINUTES: number;
  SETTLEMENT_SWEEP_BATCH_SIZE: number;
  SETTLEMENT_SWEEP_ENABLED?: boolean;
  SETTLEMENT_REVIEW_SLA_HOURS: number;
  CARRIER_POSITION_RETENTION_DAYS: number;
  CARRIER_POSITION_PURGE_SWEEP_INTERVAL_MINUTES: number;
  CARRIER_POSITION_PURGE_SWEEP_ENABLED?: boolean;
  TRACKING_SIGNAL_LOST_SECONDS: number;
  SHIPMENT_HISTORY_RETENTION_YEARS: number;
  SHIPMENT_HISTORY_PURGE_SWEEP_INTERVAL_MINUTES: number;
  SHIPMENT_HISTORY_PURGE_SWEEP_ENABLED?: boolean;
  TRIP_EXPIRY_SWEEP_INTERVAL_MINUTES: number;
  TRIP_EXPIRY_SWEEP_ENABLED?: boolean;
  PICKUP_MISSED_SWEEP_INTERVAL_MINUTES: number;
  PICKUP_MISSED_SWEEP_ENABLED?: boolean;
  PICKUP_MISSED_GRACE_HOURS: number;
  PICKUP_NO_SHOW_RATING_INVITE_ENABLED?: boolean;
  TRANSIT_ANOMALY_SWEEP_INTERVAL_MINUTES: number;
  TRANSIT_ANOMALY_SWEEP_ENABLED?: boolean;
  TRIP_DEPARTURE_REMINDER_SWEEP_INTERVAL_MINUTES: number;
  TRIP_DEPARTURE_REMINDER_SWEEP_ENABLED?: boolean;
  IN_TRANSIT_ANOMALY_FALLBACK_HOURS: number;
  IN_TRANSIT_ANOMALY_WARN_AFTER_HOURS: number;
  IN_TRANSIT_ANOMALY_DISPUTE_AFTER_HOURS: number;
  FUNDING_NEAR_PICKUP_DAYS: number;
  FUNDING_PAYMENT_TIMEOUT_MINUTES: number;
  FUNDING_RELEASE_HOURS_BEFORE_PICKUP: number;
  FUNDING_REMINDER_INTERVAL_HOURS: number;
  FUNDING_SWEEP_INTERVAL_MINUTES: number;
  FUNDING_SWEEP_ENABLED?: boolean;
  USER_DEBT_OVERDUE_DAYS: number;
  ALERT_PROVIDER: "console" | "telegram";
  ALERT_TELEGRAM_BOT_TOKEN?: string;
  ALERT_TELEGRAM_CHAT_ID?: string;
  ALERT_ENVIRONMENT_LABEL?: string;
}

export const envSchema = {
  type: "object",
  required: ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"],
  properties: {
    PORT: { type: "number", default: 3000 },
    DATABASE_URL: { type: "string" },
    REDIS_URL: { type: "string" },
    JWT_SECRET: { type: "string" },
    // MOVO-80: primera llamada interna servicio-a-servicio del repo (svc-shipments →
    // svc-users, para validar al receptor). Default apunta al nombre del servicio en
    // `movo-net` (infra/docker-compose.yml) — mismo criterio que ya usa el gateway
    // para este mismo var (gateway/src/config/env.ts), así que no hace falta setearlo
    // explícito en docker-compose.yml, el default ya coincide.
    USERS_SERVICE_URL: { type: "string", default: "http://movo-svc-users:3000" },
    // MOVO-116: bloqueo del transportista sin MP vinculado (`/internal/payments/...`).
    // Mismo criterio que USERS_SERVICE_URL: el default ya es el nombre del servicio en
    // movo-net (el mismo que usa el gateway), no hace falta setearlo en compose.
    PAYMENTS_SERVICE_URL: { type: "string", default: "http://movo-svc-payments:3000" },
    // MOVO-82: mismo criterio que USERS_SERVICE_URL -- el default ya apunta al nombre
    // del servicio en movo-net (infra/docker-compose.yml), no hace falta setearlo
    // explícito ahí. Puerto 8000 porque movo-svc-pricing-logistics es FastAPI/uvicorn
    // (ADR-002), no Fastify como el resto de los servicios Node.
    PRICING_SERVICE_URL: { type: "string", default: "http://movo-svc-pricing-logistics:8000" },
    // MOVO-81: default "mock" (mismo criterio que movo-svc-users/MOVO-97) — no depender
    // de un bucket real ni de credenciales de AWS para levantar el servicio en
    // dev/test/CI. La obligatoriedad de S3_BUCKET_NAME/S3_REGION con
    // STORAGE_PROVIDER=s3 la valida createStorageProvider al arrancar, no este schema.
    // Comparte el mismo bucket que movo-svc-users (movo-shipment-media-{env}), distinto
    // prefijo (shipments/* en vez de profile-photos/*).
    STORAGE_PROVIDER: { type: "string", enum: ["mock", "s3"], default: "mock" },
    S3_BUCKET_NAME: { type: "string" },
    S3_REGION: { type: "string" },
    // MOVO-123: mismo criterio que GEOCODING_PROVIDER (ADR-014, movo-svc-users) — mock
    // default en dev/test/CI, no depende de una API key de Google para levantar.
    ROUTES_PROVIDER: { type: "string", enum: ["mock", "google"], default: "mock" },
    // Validada en runtime por `createRoutesProvider` cuando ROUTES_PROVIDER=google, no
    // acá — mismo criterio que GOOGLE_MAPS_API_KEY en movo-svc-users/src/config/env.ts.
    GOOGLE_MAPS_API_KEY: { type: "string" },
    // MOVO-130: plazo en horas para que el receptor acepte/rechace antes de que el envío expire.
    RECEIVER_CONFIRMATION_TIMEOUT_HOURS: { type: "number", default: 48 },
    // MOVO-253: plazo en horas para que el emisor elija otro receptor tras un rechazo
    // (con tope en la ventana de retiro). Lo cierra el mismo barrido de MOVO-130.
    RECEIVER_REDESIGNATION_TIMEOUT_HOURS: { type: "number", default: 48 },
    // MOVO-275: plazo en horas de la persona invitada para aceptar una transferencia de
    // receptor. La vence el mismo barrido de MOVO-130.
    RECEIVER_TRANSFER_TIMEOUT_HOURS: { type: "number", default: 6 },
    // MOVO-130: intervalo en minutos del barrido periódico de expiración.
    RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES: { type: "number", default: 15 },
    // MOVO-130: flag para habilitar/deshabilitar el barrido periódico (útil en test/CI).
    RECEIVER_CONFIRMATION_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-124: ventana desde el presign antes de considerar huérfana una key nunca
    // confirmada (mismo criterio sugerido por el ticket). No se ata al TTL de la
    // presigned URL (300s, solo acota el PUT) porque la confirmación puede demorar
    // mucho más que la subida -- el cliente puede subir la foto y recién confirmar
    // en una sesión posterior.
    ORPHAN_PHOTO_RETENTION_HOURS: { type: "number", default: 24 },
    // MOVO-124: intervalo en minutos del barrido de fotos huérfanas.
    ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: { type: "number", default: 60 },
    // MOVO-124: flag para habilitar/deshabilitar el barrido (útil en test/CI), mismo
    // criterio que RECEIVER_CONFIRMATION_SWEEP_ENABLED.
    ORPHAN_PHOTO_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-147: constante de confianza `C` del shrinkage bayesiano del score de
    // reputación (domain/reputation.ts) -- con pocas calificaciones el score tiende a
    // la media global de la plataforma, no a la media (a veces extrema) de la propia
    // persona. Parámetro del modelo, no incrustado en el código, para poder mostrar su
    // efecto en la defensa del TFG.
    REPUTATION_CONFIDENCE_CONSTANT: { type: "number", default: 5 },
    // MOVO-147: semivida en días del decaimiento temporal de cada calificación --
    // una racha vieja no sostiene (ni condena) a alguien que hoy trabaja distinto.
    REPUTATION_DECAY_HALF_LIFE_DAYS: { type: "number", default: 180 },
    // MOVO-161: radio de desvío ortogonal máximo por defecto al corredor del viaje declarado (km)
    TRIP_DEFAULT_MAX_DETOUR_KM: { type: "number", default: 15 },
    // MOVO-276: límites duros del paquete (`domain/package-limits.ts`), validados al cotizar
    // y al crear el envío. Mismos nombres y defaults que en movo-svc-pricing-logistics, que
    // también responde 422 si se exceden.
    PACKAGE_MAX_WEIGHT_KG: { type: "number", default: 30 },
    PACKAGE_MAX_SIDE_CM: { type: "number", default: 150 },
    PACKAGE_MAX_SIDES_SUM_CM: { type: "number", default: 300 },
    // Corrección directa sobre un bug reportado (sin ticket propio): barrido que cancela
    // envíos `published` cuya ventana de retiro venció sin que nadie los tomara —
    // mismo criterio que RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES/_ENABLED (MOVO-130).
    PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES: { type: "number", default: 15 },
    PICKUP_EXPIRY_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-158 (AC7, ADR-012/017 mold) + MOVO-212: liberación de fondos al entregar.
    // "console" (default, no-op/log) para dev/test/CI; "payments" captura el hold real del
    // envío en movo-svc-payments y lo lleva a `completed`. Es el mismo switch que dejó
    // MOVO-158 para no rediseñar el punto de extensión.
    FUNDS_RELEASE_NOTIFIER: { type: "string", enum: ["console", "payments"], default: "console" },
    // MOVO-212: barrido que reintenta la captura de los envíos `delivered` que no llegaron a
    // `completed` (la captura en línea del handshake es best-effort). Solo corre con
    // FUNDS_RELEASE_NOTIFIER=payments. Es la red de seguridad: el backoff persistido y el escalado manual los hace svc-payments (MOVO-213).
    SETTLEMENT_SWEEP_INTERVAL_MINUTES: { type: "number", default: 5 },
    // Margen desde la entrega antes de que el barrido la tome, para no pisar la captura en línea.
    SETTLEMENT_SWEEP_GRACE_MINUTES: { type: "number", default: 5 },
    SETTLEMENT_SWEEP_BATCH_SIZE: { type: "number", default: 20 },
    SETTLEMENT_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-213: plazo (en horas) que se le promete al transportista cuando su cobro queda en revisión manual
    // (push "Tu cobro está demorado"). Es un compromiso del equipo operativo, por eso es configuración.
    SETTLEMENT_REVIEW_SLA_HOURS: { type: "number", minimum: 1, default: 48 },
    // MOVO-202/ADR-023: retención de la traza GPS del transportista -- días desde que
    // el envío cierra (`Shipment.lastStatusChangedAt` en un estado de
    // `POSITION_PURGE_ELIGIBLE_STATUSES`) hasta que la purga periódica la borra.
    // Evidencia para disputas (MOVO-30), no analítica -- decisión de equipo documentada
    // en el ADR, no un valor técnico.
    CARRIER_POSITION_RETENTION_DAYS: { type: "number", default: 30 },
    // MOVO-202: intervalo en minutos del barrido de purga. Menos urgente que los
    // sweeps operativos (RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES/
    // PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES, 15min): purgar con hasta 1h de rezago
    // sobre un plazo de 30 días no cambia nada material.
    CARRIER_POSITION_PURGE_SWEEP_INTERVAL_MINUTES: { type: "number", default: 60 },
    CARRIER_POSITION_PURGE_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-327: sin un ping en este plazo, el seguimiento del panel marca `signalLost` (y no
    // calcula velocidad ni ETA). Varios pings perdidos seguidos, no uno solo (cadencia ~45 s).
    TRACKING_SIGNAL_LOST_SECONDS: { type: "number", minimum: 30, default: 300 },
    // MOVO-230 (Política de Privacidad §7): años desde la baja de la última de las partes de un
    // envío hasta que se purga su historial. Plazo fijado por la política (Art. 2560 CCyCN),
    // no un valor técnico: cambiarlo es un cambio de documento.
    SHIPMENT_HISTORY_RETENTION_YEARS: { type: "number", default: 5 },
    // MOVO-230: una vez por día alcanza para un plazo en años.
    SHIPMENT_HISTORY_PURGE_SWEEP_INTERVAL_MINUTES: { type: "number", default: 1440 },
    SHIPMENT_HISTORY_PURGE_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-238: barrido que cancela viajes `declared` con `departureAt` vencido sin
    // paquetes aceptados -- mismo criterio que PICKUP_EXPIRY_SWEEP_*.
    TRIP_EXPIRY_SWEEP_INTERVAL_MINUTES: { type: "number", default: 15 },
    TRIP_EXPIRY_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-258 (D1): barrido que cancela envíos con transportista cuyo retiro no se hizo,
    // pasado el margen de gracia sobre el cierre de la ventana de retiro efectiva.
    PICKUP_MISSED_SWEEP_INTERVAL_MINUTES: { type: "number", default: 15 },
    PICKUP_MISSED_SWEEP_ENABLED: { type: "boolean", default: true },
    PICKUP_MISSED_GRACE_HOURS: { type: "number", default: 24 },
    // MOVO-270 (AC12): invitación a calificar en la push de no-retiro, hasta MOVO-337.
    PICKUP_NO_SHOW_RATING_INVITE_ENABLED: { type: "boolean", default: false },
    // MOVO-258 (D4): barrido que marca para revisión los `in_transit` que no se entregaron.
    // El fallback aplica solo si la oferta aceptada no declaró entrega estimada.
    TRANSIT_ANOMALY_SWEEP_INTERVAL_MINUTES: { type: "number", default: 15 },
    TRANSIT_ANOMALY_SWEEP_ENABLED: { type: "boolean", default: true },
    TRIP_DEPARTURE_REMINDER_SWEEP_INTERVAL_MINUTES: { type: "number", default: 15 },
    TRIP_DEPARTURE_REMINDER_SWEEP_ENABLED: { type: "boolean", default: true },
    IN_TRANSIT_ANOMALY_FALLBACK_HOURS: { type: "number", default: 48 },
    // MOVO-278 (ADR-045): horas desde la marca de D4 hasta el aviso previo al transportista
    // y hasta pasar el envío a `disputed`. WARN tiene que ser menor que DISPUTE (se valida
    // al registrar el barrido, `transit-anomaly-sweep.ts`).
    IN_TRANSIT_ANOMALY_WARN_AFTER_HOURS: { type: "number", default: 12 },
    IN_TRANSIT_ANOMALY_DISPUTE_AFTER_HOURS: { type: "number", default: 24 },
    // MOVO-210 / MOVO-215: "N" de la saga. Un retiro a N días o menos toma la ruta cercana (el
    // emisor paga al aceptar); a más de N, la ruta lejana (`assigned_unfunded` + ventana de
    // confirmación). N=3 con hold de 5 días deja 2 de tránsito, el margen del ADR-050.
    // OJO: la restricción real NO es solo N < MP_HOLD_VALIDITY_DAYS (svc-payments): el hold se
    // captura al ENTREGAR (MOVO-212), así que hace falta N + duración máxima del viaje <=
    // MP_HOLD_VALIDITY_DAYS.
    FUNDING_NEAR_PICKUP_DAYS: { type: "number", default: 3 },
    // MOVO-210 AC5: plazo del emisor para completar el pago de la ruta cercana, desde que
    // acepta la oferta (con tope en el cierre de la ventana de retiro).
    FUNDING_PAYMENT_TIMEOUT_MINUTES: { type: "number", default: 30 },
    // MOVO-210 AC9: la ruta lejana vuelve a `published` si no hay pago a esta cantidad de
    // horas ANTES del inicio de la ventana de retiro (T-24h).
    FUNDING_RELEASE_HOURS_BEFORE_PICKUP: { type: "number", default: 24 },
    // MOVO-210 AC7: cada cuántas horas se recuerda al emisor "Confirmá el pago" mientras la
    // ventana está abierta (el primer aviso sale al abrirse).
    FUNDING_REMINDER_INTERVAL_HOURS: { type: "number", default: 12 },
    // MOVO-210: barrido de la saga (timeout del pago, apertura/cierre de la ventana).
    FUNDING_SWEEP_INTERVAL_MINUTES: { type: "number", default: 5 },
    FUNDING_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-313 (ADR-044): una deuda de la cuenta corriente sin saldar hace MÁS de estos días
    // bloquea operar como transportista (declarar viaje, ofertar, editar oferta, iniciar
    // viaje). Umbral por antigüedad, sin monto mínimo. Como emisor no se bloquea.
    USER_DEBT_OVERDUE_DAYS: { type: "number", default: 14, minimum: 0 },
    // MOVO-334: alerta al equipo cuando una parte abre una disputa. Mismas vars que
    // `svc-payments` (MOVO-268): `console` = solo log, `telegram` = además al chat del equipo.
    ALERT_PROVIDER: { type: "string", enum: ["console", "telegram"], default: "console" },
    ALERT_TELEGRAM_BOT_TOKEN: { type: "string" },
    ALERT_TELEGRAM_CHAT_ID: { type: "string" },
    // Prefijo de cada alerta (`dev`, `prod`) para distinguir ambientes en el mismo chat.
    ALERT_ENVIRONMENT_LABEL: { type: "string" },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
