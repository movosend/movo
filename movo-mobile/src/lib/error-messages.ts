import { ApiError, type ApiErrorCode } from "@movo/shared/dist/errors/api-error";

/**
 * Traduce códigos de error estables de la API a mensajes en español,
 * amigables para el usuario final. El `message` que manda el backend es para
 * logs/debug, no para mostrar tal cual en la UI (puede ser técnico o estar en
 * inglés). Central para toda la app — si se agrega un `ApiErrorCode` nuevo al
 * contrato, sumar acá su traducción.
 */
const CODE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  AUTH_INVALID_CREDENTIALS: "El teléfono o la contraseña no son correctos.",
  AUTH_TOKEN_EXPIRED: "Tu sesión expiró. Iniciá sesión de nuevo.",
  AUTH_TOKEN_INVALID: "Tu sesión no es válida. Iniciá sesión de nuevo.",
  AUTH_FORBIDDEN: "No tenés permiso para hacer esto.",
  AUTH_OTP_INVALID: "El código ingresado no es correcto. Revisalo e intentá de nuevo.",
  AUTH_OTP_EXPIRED: "El código venció. Pedí uno nuevo.",
  ACCOUNT_SUSPENDED: "Tu cuenta está suspendida. Contactá a soporte para más información.",
  // MOVO-296: el login de una cuenta inhabilitada (antes respondía ACCOUNT_SUSPENDED). La pantalla
  // dedicada llega con MOVO-300; hasta entonces este mensaje evita el genérico.
  ACCOUNT_DISABLED: "Tu cuenta fue inhabilitada. Contactá a soporte para más información.",
  // El backend permite pedir una sesión de KYC desde cualquier estado salvo `approved`
  // (ver ALLOWED_SESSION_SOURCE_STATUSES en svc-users), así que el único caso real que
  // llega acá es una identidad ya verificada — un "intentá de nuevo" sería engañoso.
  KYC_SESSION_NOT_ALLOWED: "Tu identidad ya está verificada.",
  KYC_PROVIDER_ERROR: "Hubo un problema con el servicio de verificación. Intentá de nuevo más tarde.",
  STORAGE_PROVIDER_ERROR: "Hubo un problema con el almacenamiento de la imagen. Intentá de nuevo.",
  PHOTO_OBJECT_NOT_FOUND: "No pudimos procesar la imagen subida. Intentá cargarla de nuevo.",
  PHOTO_FORBIDDEN_KEY: "No tenés permiso para guardar esta foto.",
  // Evidencia de retiro/entrega (MOVO-196/MOVO-197).
  PHOTO_STAGE_LIMIT_EXCEEDED: "Ya alcanzaste el máximo de fotos permitidas para esta etapa.",
  PHOTO_CONFIRMATION_IN_PROGRESS: "Estamos terminando de procesar la foto anterior. Esperá un segundo e intentá de nuevo.",
  PICKUP_EVIDENCE_MISSING: "Todavía falta subir la evidencia fotográfica del retiro.",
  DELIVERY_EVIDENCE_MISSING: "Todavía falta subir la evidencia fotográfica de la entrega.",
  USER_NOT_FOUND: "No se encontró el usuario.",
  USER_EMAIL_ALREADY_EXISTS: "El email ya se encuentra registrado.",
  USER_PHONE_ALREADY_EXISTS: "El teléfono ya se encuentra registrado.",
  // MOVO-175 (ADR-026): explícito a propósito -- el bloqueo se revela en vez de un
  // error genérico. Aplica en las dos direcciones (quien bloqueó y quien fue bloqueado).
  USER_BLOCKED: "No podés interactuar con este usuario porque hay un bloqueo entre ustedes.",
  // MOVO-284 (ADR-040): el chat se cierra con el envío y queda en solo lectura al entregarse.
  CHAT_CLOSED: "Este chat ya no está disponible porque el envío se canceló o todavía no tiene transportista.",
  CHAT_READ_ONLY: "El envío finalizó: el chat quedó en solo lectura y ya no admite mensajes nuevos.",
  CANNOT_MODERATE_SELF: "No podés reportarte ni bloquearte a vos mismo.",
  REPORT_ALREADY_PENDING: "Ya tenés un reporte en revisión sobre esta persona. Podés sumarle información.",
  REPORT_NOT_FOUND: "Tu reporte ya no está en revisión.",
  // MOVO-228: la versión de Términos/Privacidad que manda la app no es la que el
  // backend tiene vigente. El código no dice de qué lado está el desfase: puede ser
  // una app vieja, o una app nueva contra un backend que todavía no se desplegó. El
  // copy cubre los dos casos (esperar sirve para el segundo, actualizar para el primero).
  LEGAL_DOCUMENT_VERSION_MISMATCH:
    "No pudimos registrar tu aceptación porque los Términos o la Política de Privacidad cambiaron hace poco. Probá de nuevo en unos minutos y, si sigue pasando, actualizá Movo.",
  SHIPMENT_RECEIVER_IS_SENDER: "No podés elegirte a vos mismo como receptor.",
  SHIPMENT_RECEIVER_KYC_NOT_APPROVED: "El receptor todavía no tiene su identidad verificada.",
  // Elegir otro receptor tras un rechazo (MOVO-253).
  SHIPMENT_RECEIVER_ALREADY_REJECTED: "Esta persona ya rechazó este envío. Elegí a otra.",
  SHIPMENT_REDESIGNATION_EXPIRED: "Venció el plazo para elegir otro receptor. El envío se va a cancelar.",
  // Transferencia de receptor (MOVO-275).
  SHIPMENT_RECEIVER_TRANSFER_LIMIT: "Este envío ya cambió de receptor una vez.",
  SHIPMENT_RECEIVER_TRANSFER_PENDING: "Ya le pediste a alguien que reciba este envío. Esperá su respuesta o cancelá la solicitud.",
  SHIPMENT_RECEIVER_TRANSFER_EXPIRED: "Venció el plazo para aceptar esta invitación.",
  SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED: "En este momento ya no se puede cambiar quién recibe el envío.",
  SHIPMENT_RECEIVER_TRANSFER_INVALID_TARGET: "Esa persona no puede recibir este envío. Elegí a otra.",
  RECEIVER_TRANSFER_NOT_FOUND: "No encontramos esta solicitud.",
  RECEIVER_TRANSFER_NOT_PENDING: "Esta solicitud ya no está vigente.",
  // MOVO-308 (ADR-047): el sheet de cancelación re-cotiza solo; este texto es para cualquier
  // otro lugar que lo reciba.
  CANCELLATION_PENALTY_MISMATCH: "El monto de la penalidad cambió. Revisalo y confirmá de nuevo.",
  SHIPMENT_PICKUP_WINDOW_IN_PAST: "Elegí una fecha y horario de retiro que todavía no haya pasado.",
  SHIPMENT_PICKUP_WINDOW_INVALID: "El horario de fin del retiro tiene que ser posterior al de inicio.",
  SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE: "El retiro y la entrega tienen que estar en ubicaciones distintas.",
  // MOVO-276: el wizard ya valida lo mismo; esto cubre una recalibración de los límites del backend.
  PACKAGE_LIMITS_EXCEEDED: "El paquete supera el peso o las medidas que se pueden enviar. Revisá los datos del paquete.",
  GEOCODING_PROVIDER_ERROR: "No pudimos validar la dirección en el mapa. Intentá de nuevo.",
  GEOCODING_ADDRESS_NOT_FOUND: "No encontramos la dirección ingresada.",
  // Edición de perfil (MOVO-135 / backend MOVO-133).
  PHONE_ALREADY_IN_USE: "Ese teléfono ya está asociado a otra cuenta.",
  EMAIL_ALREADY_IN_USE: "Ese email ya está asociado a otra cuenta.",
  PROFILE_NAME_LOCKED_BY_KYC:
    "Tu nombre quedó verificado con tu documento y no se puede editar.",
  // Baja de cuenta (MOVO-136 / backend MOVO-134). El backend no cancela en cascada a
  // propósito: el usuario resuelve lo que bloquea y reintenta, así que el mensaje
  // tiene que decir qué hacer, no solo que falló.
  ACCOUNT_HAS_ACTIVE_SHIPMENTS:
    "Tenés envíos en curso. Cancelalos o esperá a que terminen para poder dar de baja tu cuenta.",
  ACCOUNT_HAS_ACTIVE_DISPUTES:
    "Tenés una disputa abierta. Un administrador tiene que resolverla antes de que puedas dar de baja tu cuenta.",
  ACCOUNT_DELETION_IN_PROGRESS: "Ya hay una baja en curso para tu cuenta. Esperá unos segundos.",
  SHIPMENTS_SERVICE_UNAVAILABLE:
    "No pudimos verificar si tenés envíos en curso. Intentá de nuevo en unos minutos.",
  // Declarar/editar/cancelar viaje (MOVO-162 / backend MOVO-161).
  CARRIER_NOT_VERIFIED:
    "Necesitás tener tu identidad verificada como transportista para declarar viajes.",
  TRIP_NOT_FOUND: "No encontramos ese viaje.",
  TRIP_HAS_ACCEPTED_PACKAGES:
    "Este viaje ya tiene paquetes aceptados, así que no se puede modificar. Si necesitás cancelarlo, usá «Cancelar viaje» desde el detalle.",
  TRIP_ORIGIN_DESTINATION_TOO_CLOSE:
    "El origen y el destino tienen que estar separados por al menos 100 metros.",
  TRIP_DEPARTURE_IN_PAST: "La fecha y hora de salida tiene que ser futura.",
  TRIP_NOT_ACTIVE: "Este viaje ya no está activo.",
  // Viajes recurrentes (MOVO-266 / backend MOVO-265).
  RECURRING_SERIES_LIMIT: "Ya tenés 3 viajes que se repiten. Dejá de repetir alguno para sumar otro.",
  TRIP_NOT_SERIES_HEAD: "Este viaje ya tiene el siguiente declarado: los días se cambian desde ese.",
  // Iniciar viaje (MOVO-221 / MOVO-252).
  TRIP_NOT_DECLARED: "El viaje ya fue iniciado o finalizado.",
  TRIP_ALREADY_HAS_ACTIVE_TRIP:
    "Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez.",
  TRIP_NOT_AVAILABLE: "Este viaje ya no está disponible.",
  TRIP_NO_PACKAGES: "Este viaje no tiene paquetes asignados, así que no se puede iniciar.",
  // MOVO-277: el caso con fecha lo arma `formatTripStartErrorMessage` (trip-format.ts).
  TRIP_START_TOO_EARLY: "Todavía no podés iniciar este viaje: se habilita el día de salida.",
  TRIP_PACKAGES_NOT_READY:
    "Tus paquetes todavía esperan la confirmación del pago. Vas a poder iniciar el viaje cuando estén listos para retirar.",
  // Calificaciones post-entrega (MOVO-153 / backend MOVO-146).
  SHIPMENT_NOT_DELIVERED: "El envío todavía no fue entregado.",
  SHIPMENT_RATING_DISPUTE_ACTIVE:
    "El envío tiene una disputa activa. Vas a poder calificar cuando se resuelva la disputa.",
  SHIPMENT_RATING_WINDOW_EXPIRED: "El plazo de 72 horas para calificar este envío ya terminó.",
  SHIPMENT_RATING_ALREADY_EXISTS: "Ya calificaste a esta persona en este envío.",
  SHIPMENT_RATING_NOT_FOUND: "No se encontró una calificación previa para editar.",
  // Creación de oferta (MOVO-149 / backend MOVO-143).
  SHIPMENT_NOT_AVAILABLE_FOR_OFFER: "Este envío ya no está disponible para ofertar.",
  OFFER_DUPLICATE_ACTIVE: "Ya tenés una oferta activa sobre este envío.",
  OFFER_DATE_OUT_OF_RANGE: "La fecha del viaje tiene que coincidir con la fecha de retiro del envío.",
  // MOVO-116 (ADR-036): lo ve el emisor al aceptar la oferta de un transportista que ya no
  // cumple los requisitos para operar.
  OFFER_CARRIER_NOT_ELIGIBLE: "Este transportista ya no puede tomar envíos. Elegí otra oferta.",
  // MOVO-117: los ve el transportista. Las pantallas que pueden recibirlos abren la
  // checklist de requisitos (`useCarrierRequirementsSheet`); este texto es el respaldo
  // para quien no la monta.
  CARRIER_LICENSE_NOT_APPROVED: "Necesitás tu licencia de conducir verificada para operar como transportista.",
  CARRIER_MP_ACCOUNT_NOT_LINKED: "Necesitás vincular tu cuenta de Mercado Pago para operar como transportista.",
  // MOVO-278 (ADR-045): no es un paso de la checklist (el transportista no lo puede
  // completar), así que se muestra como error: se levanta cuando se resuelve la disputa.
  CARRIER_DISPUTE_OPEN:
    "Tenés una disputa abierta como transportista. Vas a poder operar cuando se resuelva.",
  // MOVO-313 (ADR-044): tampoco es un paso de la checklist, se resuelve con un pago. Como
  // emisor no se bloquea: su próximo pago ya incluye la deuda (MOVO-311).
  // Se salda desde Perfil > Pagos y cobros > Saldo (MOVO-315).
  USER_DEBT_OVERDUE:
    "Tenés una deuda vencida con Movo y por ahora no podés operar como transportista. Pagá tu saldo desde Pagos y cobros para volver a operar.",
  // MOVO-315: pago del saldo con tarjeta.
  BALANCE_PAYMENT_IN_PROGRESS: "Ya hay un pago de tu saldo en curso. Esperá a que se confirme antes de volver a pagar.",
  BALANCE_AMOUNT_EXCEEDS_DEBT: "El monto supera tu saldo pendiente. Actualizá la pantalla e intentá de nuevo.",
  BALANCE_COLLECTOR_NOT_CONFIGURED: "Por ahora no podés pagar el saldo con tarjeta. Tu saldo no cambió: probá más tarde.",
  // No son un requisito que el usuario pueda resolver: no se pudo verificar, se reintenta.
  USERS_SERVICE_UNAVAILABLE: "No pudimos verificar tus requisitos. Intentá de nuevo en unos minutos.",
  PAYMENTS_SERVICE_UNAVAILABLE: "No pudimos verificar tu cuenta de Mercado Pago. Intentá de nuevo en unos minutos.",
  // Handshake criptográfico: escaneo del receptor de custodia (MOVO-160 / backend MOVO-158, Done).
  HANDSHAKE_QR_EXPIRED: "Este código venció. Pedile a la otra persona que genere uno nuevo.",
  HANDSHAKE_DISTANCE_EXCEEDED: "Estás a más de 100 m del punto. Acercate e intentá de nuevo.",
  HANDSHAKE_INVALID_SIGNATURE: "Este código no es válido. Pedile a la otra persona que genere uno nuevo.",
  HANDSHAKE_CEDENTE_KEY_MISSING:
    "La otra persona todavía no puede confirmar la transferencia desde su dispositivo. Pedile que actualice la app.",
  HANDSHAKE_INVALID_SHIPMENT_STATE: "Este envío ya no está en un estado que permita confirmar esto.",
  SHIPMENT_NOT_TRACKABLE: "El envío no se encuentra en un viaje activo para realizar seguimiento.",
  // MOVO-111/112: vinculación de Mercado Pago. Los cuatro últimos llegan en el deep link
  // de vuelta del navegador embebido, no como respuesta HTTP.
  MP_CONNECT_NOT_CONFIGURED: "La vinculación con Mercado Pago no está disponible por ahora. Probá más tarde.",
  MP_CONNECT_STATE_INVALID: "La vinculación tardó demasiado y se venció. Probá de nuevo.",
  MP_CONNECT_ACCESS_DENIED: "No autorizaste a Movo en Mercado Pago. Para cobrar tus envíos, tenés que aceptar el permiso.",
  MP_CONNECT_EXCHANGE_FAILED: "Mercado Pago no respondió al confirmar la vinculación. Probá de nuevo.",
  // Tarjetas guardadas (MOVO-101, backend MOVO-100).
  CARD_IN_USE:
    "Esta tarjeta tiene una reserva de fondos de un envío en curso. Vas a poder eliminarla cuando se libere.",
  CARD_LIMIT_REACHED: "Llegaste al máximo de tarjetas guardadas. Eliminá una para agregar otra.",
  CARD_SAVE_REJECTED: "Tu banco no aprobó la tarjeta. Revisá los datos o probá con otra. No se cobró nada.",
  CARD_CUSTOMER_CONFLICT: "No pudimos asociar la tarjeta a tu cuenta. Escribinos a soporte para resolverlo.",
  CARDS_NOT_CONFIGURED: "Guardar tarjetas no está disponible por ahora. Probá más tarde.",
  // Pago del envío con tarjeta guardada (MOVO-269, backend MOVO-210/282).
  SHIPMENT_FUNDING_NOT_AVAILABLE: "Ya no se puede pagar este envío. Puede haber vencido el plazo o cambiado de estado.",
  SAVED_CARD_NOT_FOUND: "No encontramos esa tarjeta. Elegí otra o agregala de nuevo.",
  HOLD_CONFLICT: "Ya hay una reserva de fondos en curso para este envío. Actualizamos los datos: revisalos e intentá de nuevo.",
  PAYMENT_PROVIDER_ERROR: "Mercado Pago no respondió. No se cobró nada: probá de nuevo en unos minutos.",
  MP_ACCOUNT_ALREADY_LINKED: "Esa cuenta de Mercado Pago ya está vinculada a otro usuario de Movo.",
  VALIDATION_FAILED: "Revisá los datos ingresados, hay algo que no es válido.",
  NOT_FOUND: "No encontramos lo que buscábamos.",
  RATE_LIMIT_EXCEEDED: "Hiciste demasiados intentos. Esperá un momento y volvé a intentar.",
  INTERNAL_ERROR: "Ocurrió un error inesperado. Intentá de nuevo en unos minutos.",
};

/**
 * Mensaje en español para un código de error estable, o `fallback` si no tiene traducción.
 * Para los códigos que no llegan como `ApiError` (ej. los que vuelven por deep link).
 */
export function messageForCode(code: ApiErrorCode, fallback: string): string {
  return CODE_MESSAGES[code] ?? fallback;
}

/**
 * Mensaje user-friendly a partir de un error de API, con fallback específico
 * de la acción que falló. Las fallas de red (`statusCode === 0`) ya traen un
 * mensaje armado por `http-client.ts` ("No se pudo conectar…") — se muestra
 * tal cual porque es el caso donde más importa ser preciso (vs. genérico) y
 * ya está en español.
 *
 * `overrides` (MOVO-136) permite que una pantalla puntual reescriba el mensaje de un
 * código cuyo texto global está redactado para otro contexto. El caso que lo motivó:
 * `AUTH_INVALID_CREDENTIALS` dice "El teléfono o la contraseña no son correctos"
 * porque nació para el login, pero en "Cuenta y seguridad" no hay ningún teléfono en
 * juego — ahí significa "la contraseña actual no es correcta". Es un override, no un
 * cambio del mapa global: el mensaje del login sigue siendo el correcto para el login.
 */
export function friendlyErrorMessage(
  err: unknown,
  fallback: string,
  overrides?: Partial<Record<ApiErrorCode, string>>,
): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.statusCode === 0) return err.message;
  return overrides?.[err.code] ?? messageForCode(err.code, fallback);
}
