import { NotificationCategoryId } from "./notification-categories";

/**
 * MOVO-245: único lugar donde vive el copy (título/cuerpo) de cada push que dispara
 * el backend -- antes esparcido a mano en `shipments.service.ts`/`offers.service.ts`/
 * `ratings.service.ts` (`movo-svc-shipments`) y en el flujo de handshake. Un trigger
 * nuevo se agrega acá (con su categoría) y el caller solo pasa los parámetros de
 * interpolación (`render(params)`) -- nunca arma el string a mano en el módulo de
 * negocio.
 *
 * La pantalla de Configuración de notificaciones (`movo-mobile`) importa
 * `NOTIFICATION_TRIGGERS` para mostrar, dentro de cada categoría, el copy real de
 * cada aviso que agrupa (AC de "personalizar los textos desde un único lugar") --
 * usa `displayCopy` (versión sin datos dinámicos, ej. "El receptor" en vez del
 * nombre real) porque ahí no hay ningún envío/oferta concreto sobre el que
 * interpolar, es una vista de catálogo, no un push real.
 */
export type NotificationTriggerKey =
  | "shipmentCreated"
  | "shipmentAccepted"
  | "shipmentRejected"
  | "shipmentCancelledConfirmationTimeout"
  | "shipmentCancelledPickupExpired"
  | "offerCreated"
  | "offerAccepted"
  | "offerSuperseded"
  | "offerRejected"
  | "offerVoidedByShipmentCancellation"
  | "tripMatch"
  | "tripAutoCreated"
  | "ratingReceived"
  | "custodyPickupConfirmed"
  | "custodyDeliveryConfirmed";

export interface NotificationCopy {
  title: string;
  body: string;
}

export interface NotificationTriggerDefinition<TParams = void> {
  category: NotificationCategoryId;
  /** Copy mostrado en la pantalla de Configuración, sin datos dinámicos reales. */
  displayCopy: NotificationCopy;
  /** Copy real que se manda por push -- recibe los parámetros de interpolación del
   * caller (nombre de la contraparte, etc.). Los triggers sin ningún dato dinámico
   * simplemente ignoran el argumento y devuelven `displayCopy` tal cual. */
  render: (params: TParams) => NotificationCopy;
}

function definition<TParams = void>(
  category: NotificationCategoryId,
  displayCopy: NotificationCopy,
  render: (params: TParams) => NotificationCopy
): NotificationTriggerDefinition<TParams> {
  return { category, displayCopy, render };
}

export const NOTIFICATION_TRIGGERS = {
  shipmentCreated: definition<{ senderName: string }>(
    "shipments",
    { title: "Tenés un envío nuevo para confirmar", body: "Alguien te envió un paquete. Tocá para revisar y confirmar el envío." },
    ({ senderName }) => ({
      title: "Tenés un envío nuevo para confirmar",
      body: `${senderName} te envió un paquete. Tocá para revisar y confirmar el envío.`,
    })
  ),
  shipmentAccepted: definition<{ receiverName: string }>(
    "shipments",
    { title: "Envío aceptado", body: "El receptor aceptó el envío, ya está publicado." },
    ({ receiverName }) => ({ title: "Envío aceptado", body: `${receiverName} aceptó el envío, ya está publicado` })
  ),
  shipmentRejected: definition<{ receiverName: string }>(
    "shipments",
    { title: "Envío rechazado", body: "El receptor rechazó el envío." },
    ({ receiverName }) => ({ title: "Envío rechazado", body: `${receiverName} rechazó el envío` })
  ),
  shipmentCancelledConfirmationTimeout: definition<{ receiverName: string }>(
    "shipments",
    { title: "Envío cancelado", body: "Tu envío se canceló: el receptor no lo confirmó a tiempo." },
    ({ receiverName }) => ({
      title: "Envío cancelado",
      body: `Tu envío se canceló: ${receiverName} no lo confirmó a tiempo`,
    })
  ),
  shipmentCancelledPickupExpired: definition<void>(
    "shipments",
    { title: "Envío cancelado", body: "Tu envío se canceló: ningún transportista lo retiró dentro de la ventana publicada." },
    () => ({
      title: "Envío cancelado",
      body: "Tu envío se canceló: ningún transportista lo retiró dentro de la ventana publicada",
    })
  ),
  offerCreated: definition<{ carrierName: string | null }>(
    "offers",
    { title: "Nueva oferta en tu envío", body: "Un transportista ofertó por tu envío." },
    ({ carrierName }) => ({
      title: "Nueva oferta en tu envío",
      body: carrierName ? `${carrierName} ofertó por tu envío.` : "Recibiste una nueva oferta.",
    })
  ),
  offerAccepted: definition<void>(
    "offers",
    { title: "Tu oferta fue aceptada", body: "El emisor eligió tu oferta para este envío." },
    () => ({ title: "Tu oferta fue aceptada", body: "El emisor eligió tu oferta para este envío." })
  ),
  offerSuperseded: definition<void>(
    "offers",
    { title: "Tu oferta ya no está disponible", body: "El emisor eligió otra oferta para este envío." },
    () => ({ title: "Tu oferta ya no está disponible", body: "El emisor eligió otra oferta para este envío." })
  ),
  offerRejected: definition<void>(
    "offers",
    { title: "Tu oferta fue rechazada", body: "El emisor rechazó tu oferta para este envío." },
    () => ({ title: "Tu oferta fue rechazada", body: "El emisor rechazó tu oferta para este envío." })
  ),
  // El envío se canceló y con eso se anuló la oferta pendiente del transportista --
  // desde su perspectiva es un evento sobre SU oferta, no sobre el ciclo de vida de
  // un envío ajeno (decisión tomada explícitamente en el refinamiento de MOVO-245,
  // categoría "Ofertas" y no "Envíos" aunque `data.type` histórico decía "shipment").
  offerVoidedByShipmentCancellation: definition<void>(
    "offers",
    { title: "Tu oferta fue cancelada", body: "El envío ya no está disponible." },
    () => ({ title: "Tu oferta fue cancelada", body: "El envío ya no está disponible." })
  ),
  tripMatch: definition<{ originShort: string; destinationShort: string }>(
    "trips",
    { title: "Nuevo paquete compatible", body: "Hay un envío compatible con tu viaje." },
    ({ originShort, destinationShort }) => ({
      title: "Nuevo paquete compatible",
      body: `Hay un envío compatible con tu viaje ${originShort} → ${destinationShort}`,
    })
  ),
  tripAutoCreated: definition<void>(
    "trips",
    {
      title: "Se creó un viaje a partir de este envío",
      body: "Armamos un viaje en tu cuenta con este envío -- vas a recibir avisos de otros paquetes compatibles con esta ruta.",
    },
    () => ({
      title: "Se creó un viaje a partir de este envío",
      body: "Armamos un viaje en tu cuenta con este envío -- vas a recibir avisos de otros paquetes compatibles con esta ruta.",
    })
  ),
  ratingReceived: definition<void>(
    "ratings",
    { title: "Recibiste una calificación", body: "Alguien calificó tu participación en un envío. Mirala en tu perfil." },
    () => ({
      title: "Recibiste una calificación",
      body: "Alguien calificó tu participación en un envío. Mirala en tu perfil.",
    })
  ),
  // MOVO-245 (nuevo, sobre el handshake ya Done de MOVO-158/196): antes no disparaba
  // ningún push -- el usuario se enteraba solo reabriendo la app (ver MOVO-240).
  custodyPickupConfirmed: definition<void>(
    "custody",
    { title: "Retiro confirmado", body: "El transportista retiró tu paquete y quedó bajo su custodia." },
    () => ({ title: "Retiro confirmado", body: "El transportista retiró tu paquete y quedó bajo su custodia." })
  ),
  custodyDeliveryConfirmed: definition<void>(
    "custody",
    { title: "Entrega confirmada", body: "El receptor confirmó que recibió el paquete." },
    () => ({ title: "Entrega confirmada", body: "El receptor confirmó que recibió el paquete." })
  ),
};

export type NotificationTriggers = typeof NOTIFICATION_TRIGGERS;

export function notificationTriggerCopy(key: NotificationTriggerKey): NotificationCopy {
  return NOTIFICATION_TRIGGERS[key].displayCopy;
}

export function notificationTriggerCategory(key: NotificationTriggerKey): NotificationCategoryId {
  return NOTIFICATION_TRIGGERS[key].category;
}

/** Renderiza el copy real (con interpolación) de un trigger dado sus parámetros --
 * tipado por `key` gracias al mapa literal de `NOTIFICATION_TRIGGERS`. */
export function renderNotificationTrigger<K extends NotificationTriggerKey>(
  key: K,
  params: Parameters<NotificationTriggers[K]["render"]>[0]
): NotificationCopy {
  return NOTIFICATION_TRIGGERS[key].render(params as never);
}
