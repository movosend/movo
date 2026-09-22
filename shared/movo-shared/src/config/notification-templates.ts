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
  | "custodyPickupConfirmedReceiver"
  | "custodyDeliveryConfirmedSender"
  | "custodyDeliveryConfirmedCarrier"
  | "tripStartedSender"
  | "tripStartedReceiver";

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

/** Formatea minutos de ETA en "N min" o "N h" / "N h M min" -- un viaje interurbano
 * real puede tardar horas, no solo minutos (ver `custodyPickupConfirmedReceiver`), y
 * "Llega en aprox. 135 min" se lee peor que "Llega en aprox. 2 h 15 min". */
function formatEtaDuration(etaMinutes: number): string {
  const minutes = Math.max(0, Math.round(etaMinutes));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
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
  offerCreated: definition<{ carrierName: string | null; deliveryShort: string }>(
    "offers",
    { title: "Nueva oferta en tu envío", body: "Un transportista ofertó por tu envío." },
    ({ carrierName, deliveryShort }) => ({
      title: "Nueva oferta en tu envío",
      body: carrierName
        ? `${carrierName} ofertó por tu envío a ${deliveryShort}.`
        : `Recibiste una nueva oferta en tu envío a ${deliveryShort}.`,
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
      body: `Hay un envío compatible con tu viaje de ${originShort} → ${destinationShort}`,
    })
  ),
  tripAutoCreated: definition<void>(
    "trips",
    {
      title: "Se creó un viaje a partir de este envío",
      body: "Armamos un viaje en tu cuenta con este envío. Vas a recibir avisos de otros paquetes compatibles con esta ruta.",
    },
    () => ({
      title: "Se creó un viaje a partir de este envío",
      body: "Armamos un viaje en tu cuenta con este envío. Vas a recibir avisos de otros paquetes compatibles con esta ruta.",
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
  custodyPickupConfirmed: definition<{ carrierName: string }>(
    "custody",
    { title: "Retiro confirmado", body: "El transportista retiró tu paquete y esta en camino al destino." },
    ({ carrierName }) => ({
      title: "Retiro confirmado",
      body: `${carrierName} retiró tu paquete y esta en camino al destino.`,
    })
  ),
  // Ajuste post-MOVO-245: el receptor no recibía ningún aviso en el retiro (solo se
  // enteraba al llegar la entrega) -- copy propio, distinto del que recibe el emisor,
  // con el ETA estimado cuando `routesProvider` pudo resolverlo (best-effort, nunca
  // bloquea el push si falla -- ver `handshake.service.ts`). El ETA es una estimación
  // de tiempo de viaje sin ventanas de espera/paradas intermedias -- puede terminar
  // siendo de horas en un envío de larga distancia, así que SIEMPRE cierra invitando
  // a seguir el estado real desde la app en vez de prometer un horario exacto.
  custodyPickupConfirmedReceiver: definition<{ carrierName: string; etaMinutes: number | null }>(
    "custody",
    {
      title: "Tu paquete está en camino",
      body: "El transportista retiró el paquete y ya está en camino. Seguilo desde la app.",
    },
    ({ carrierName, etaMinutes }) => {
      const eta = etaMinutes !== null ? formatEtaDuration(etaMinutes) : null;
      return {
        title: "Tu paquete está en camino",
        body: eta
          ? `${carrierName} retiró el paquete. Llega en aprox. ${eta}. Seguilo desde la app.`
          : `${carrierName} retiró el paquete y ya está en camino. Seguilo desde la app.`,
      };
    }
  ),
  // Ajuste post-MOVO-245: emisor y transportista recibían el mismo texto en la
  // entrega ("El receptor confirmó que recibió el paquete") -- separado en dos
  // triggers con copy propio por destinatario.
  custodyDeliveryConfirmedSender: definition<{ receiverName: string }>(
    "custody",
    { title: "Entrega confirmada", body: "El receptor confirmó que recibió tu paquete." },
    ({ receiverName }) => ({
      title: "Entrega confirmada",
      body: `${receiverName} confirmó que recibió tu paquete.`,
    })
  ),
  custodyDeliveryConfirmedCarrier: definition<{ receiverName: string }>(
    "custody",
    { title: "Entrega confirmada", body: "El receptor confirmó la entrega. ¡Gracias por tu viaje con Movo!" },
    ({ receiverName }) => ({
      title: "Entrega confirmada",
      body: `${receiverName} confirmó la entrega. ¡Gracias por tu viaje con Movo!`,
    })
  ),
  // Nuevo (a pedido explícito): antes `startTrip` no avisaba a nadie -- emisor y
  // receptor solo se enteraban de que el transportista se puso en movimiento al
  // llegar el push de retiro confirmado (a veces horas después). Categoría "custody"
  // -- mismo tema de fondo que los triggers de handshake de arriba (cuándo pasa algo
  // con la custodia física de MI paquete), no uno nuevo por un evento adyacente.
  //
  // Al emisor con ETA (hasta el retiro de SU paquete, mismo formato/cierre que
  // `custodyPickupConfirmedReceiver` -- ver `formatEtaDuration`); al receptor SIN
  // ETA a propósito: en este punto el transportista recién arranca el viaje, puede
  // tener otras paradas antes de llegar a buscar el paquete de este receptor, así
  // que cualquier estimación de cuándo LE va a llegar a él sería inventada.
  tripStartedSender: definition<{ carrierName: string; etaMinutes: number | null }>(
    "custody",
    {
      title: "Tu transportista salió de viaje",
      body: "El transportista inició su viaje camino a retirar tu paquete.",
    },
    ({ carrierName, etaMinutes }) => {
      const eta = etaMinutes !== null ? formatEtaDuration(etaMinutes) : null;
      return {
        title: "Tu transportista salió de viaje",
        body: eta
          ? `${carrierName} inició su viaje. Llega a retirar tu paquete en aprox. ${eta}. Seguilo desde la app.`
          : `${carrierName} inició su viaje camino a retirar tu paquete. Seguilo desde la app.`,
      };
    }
  ),
  tripStartedReceiver: definition<{ carrierName: string }>(
    "custody",
    {
      title: "Salieron a buscar tu paquete",
      body: "El transportista inició su viaje camino a retirar tu paquete. Te avisamos cuando esté en camino a vos.",
    },
    ({ carrierName }) => ({
      title: "Salieron a buscar tu paquete",
      body: `${carrierName} inició su viaje camino a retirar tu paquete. Te avisamos cuando esté en camino a vos.`,
    })
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
