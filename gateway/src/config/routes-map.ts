/**
 * Mapa declarativo de rutas del gateway.
 *
 * Dos listas:
 *
 * 1. `serviceRoutes`: mapea prefijos a microservicios. Sin flag público/protegido — ese
 *    control sale de `publicRoutes` (match exacto por método + path) + `allowedRoles`
 *    genérico (validación por prefijo si se declara).
 *
 * 2. `publicRoutes`: lista de `{ method, path }` con match exacto. Por defecto, cualquier
 *    request que NO matchee exacta aquí → se requiere autenticación. Esto evita que un
 *    dev agregue un nuevo endpoint sin marcar explícitamente si es público o no.
 *
 * Zona de conflicto para nuevas rutas públicas:
 * - Agregar un objeto nuevo al final de `publicRoutes` (un línea lógica por objeto).
 * - Nunca reordenes líneas existentes.
 */

import { UserRole } from "@movo/shared";

/** Prefijo global bajo el que se expone todo el ruteo a microservicios (AC1). */
export const API_PREFIX = "/api/v1";

export interface ServiceRoute {
  prefix: string;
  upstream: string;
  allowedRoles?: UserRole[];
}

export interface PublicRoute {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  rateLimit?: {
    max: number;
    timeWindow: string;
  };
}

export interface RateLimitedRoute {
  method: PublicRoute["method"];
  path: string;
  rateLimit: {
    max: number;
    timeWindow: string;
  };
}

export function getServiceRoutes(env: {
  USERS_SERVICE_URL: string;
  SHIPMENTS_SERVICE_URL: string;
  PAYMENTS_SERVICE_URL: string;
  ADMIN_SERVICE_URL: string;
  PRICING_LOGISTICS_SERVICE_URL?: string;
}): ServiceRoute[] {
  return [
    // users service
    {
      prefix: "/auth",
      upstream: env.USERS_SERVICE_URL,
    },
    {
      prefix: "/users",
      upstream: env.USERS_SERVICE_URL,
    },

    // shipments service
    {
      prefix: "/shipments",
      upstream: env.SHIPMENTS_SERVICE_URL,
    },

    // payments service (fuera de alcance este sprint, ver MOVO-68: solo
    // svc-users y svc-shipments están vivos. Descomentar cuando el servicio
    // esté listo para proxear)
    // {
    //   prefix: "/payments",
    //   upstream: env.PAYMENTS_SERVICE_URL,
    //   allowedRoles: [UserRole.SENDER, UserRole.CARRIER],
    // },

    // admin service (fuera de alcance este sprint, ver MOVO-68)
    // {
    //   prefix: "/admin",
    //   upstream: env.ADMIN_SERVICE_URL,
    //   allowedRoles: [UserRole.ADMIN],
    // },

    // pricing-logistics service (futuro)
    // {
    //   prefix: "/pricing",
    //   upstream: env.PRICING_LOGISTICS_SERVICE_URL!,
    // },

    // kyc (MOVO-72): reemplaza el placeholder "/webhooks" de MOVO-68 — el path real
    // del webhook de Didit.me quedó definido bajo /kyc/webhook (AC4), no /webhooks/didit.
    {
      prefix: "/kyc",
      upstream: env.USERS_SERVICE_URL,
    },

    // geocode (MOVO-73): paso de mapa del wizard de registro, proxea la Geocoding API
    // de Google server-side. Público (ver publicRoutes) — se llama antes de que exista
    // cuenta o token.
    {
      prefix: "/geocode",
      upstream: env.USERS_SERVICE_URL,
    },

    // addresses (MOVO-119): CRUD de libreta de direcciones guardadas. Prefijo propio
    // (no anidado bajo /users) porque el ticket define el contrato así -- mismo
    // criterio que /kyc y /geocode. Protegido por defecto (no está en publicRoutes).
    {
      prefix: "/addresses",
      upstream: env.USERS_SERVICE_URL,
    },

    // places (MOVO-83): paso de direcciones del wizard de envío (estilo Uber/Pedidos
    // Ya), proxea la Places API (New) de Google server-side. Público (ver
    // publicRoutes) — mismo criterio que /geocode, ninguna razón de negocio para
    // exigir token acá aunque en la práctica solo lo llama un usuario ya logueado.
    {
      prefix: "/places",
      upstream: env.USERS_SERVICE_URL,
    },
  ];
}

export function getPublicRoutes(): PublicRoute[] {
  return [
    // auth endpoints
    { method: "POST", path: "/auth/register" },
    {
      method: "POST",
      path: "/auth/login",
      // Límite estricto por IP (AC9): un intento de fuerza bruta contra
      // contraseñas no debería poder usar el límite general (200/min).
      rateLimit: { max: 5, timeWindow: "15 minutes" },
    },
    { method: "POST", path: "/auth/refresh" },
    // MOVO-71: reemplaza el placeholder de "/auth/verify-phone" (contrato viejo,
    // OTP post-registro) — el vigente es OTP antes de crear la cuenta, sin token
    // todavía, así que las tres rutas son públicas.
    { method: "POST", path: "/auth/send-otp" },
    { method: "POST", path: "/auth/verify-otp" },
    { method: "POST", path: "/auth/resend-otp" },

    // kyc (MOVO-72): /kyc/session y /kyc/status pasaron a ser rutas PROTEGIDAS
    // (revisión de PR #51, tmvergara) — ahora que POST /auth/register emite tokens de
    // sesión igual que login, el diseño original de MOVO-72 (rutas públicas + userId
    // explícito, porque register no tenía tokens) ya no hace falta. El userId se
    // deriva del JWT (header x-user-id inyectado más abajo), no de un parámetro
    // adivinable — MOVO-94 queda resuelto por este cambio, no solo mitigado. Rate
    // limit estricto tampoco hace falta más: quedan bajo el general (200/min), como
    // cualquier otra ruta protegida.
    //
    // Webhook de Didit.me (AC4/AC5): no lleva JWT ni puede — Didit no tiene uno. Se
    // protege con verificación de firma (X-Signature-V2) del lado de svc-users, no acá.
    { method: "POST", path: "/kyc/webhook" },

    // geocode (MOVO-73): se llama durante el wizard de registro, antes de que exista
    // cuenta o token — mismo momento del onboarding que send-otp/verify-otp. Rate limit
    // propio para no quedar abierto como proxy gratuito de la API de Google.
    {
      method: "POST",
      path: "/geocode",
      rateLimit: { max: 20, timeWindow: "15 minutes" },
    },

    // places (MOVO-83): autocomplete se dispara por cada tecleo (debounced en el
    // cliente) del paso de direcciones del wizard de envío — presupuesto de rate
    // limit más generoso que /geocode (un solo llamado por dirección) para no
    // interrumpir la búsqueda a mitad de tipeo.
    {
      method: "POST",
      path: "/places/autocomplete",
      rateLimit: { max: 30, timeWindow: "15 minutes" },
    },
    {
      method: "POST",
      path: "/places/details",
      rateLimit: { max: 30, timeWindow: "15 minutes" },
    },
  ];
}

export function isPublicRoute(
  method: string,
  path: string,
): PublicRoute | undefined {
  return getPublicRoutes().find(
    (r) => r.method === method.toUpperCase() && r.path === path,
  );
}

/**
 * Rate limit estricto sobre rutas PROTEGIDAS (a diferencia de `PublicRoute.rateLimit`,
 * que solo aplica a las de `getPublicRoutes()`). MOVO-97: `POST /users/me/photo/
 * upload-url` necesita un límite propio (AC8) pese a requerir JWT — emitir presigned
 * URLs es barato para nosotros pero es la puerta de entrada a escribir en el bucket de
 * S3. Separada de `getPublicRoutes()` a propósito: no cambia si la ruta es pública o
 * no, solo le suma un limiter estricto además de la autenticación normal.
 */
export function getRateLimitOverrides(): RateLimitedRoute[] {
  return [
    {
      method: "POST",
      path: "/users/me/photo/upload-url",
      rateLimit: { max: 20, timeWindow: "15 minutes" },
    },
    // MOVO-123: proxy directo a Google Routes API (pago) — mismo criterio que
    // /geocode y /places/*, para no quedar abierto como proxy gratuito de Google.
    // Se llama una vez por paso de resumen del wizard de envíos, no por tecleo.
    {
      method: "GET",
      path: "/shipments/route",
      rateLimit: { max: 20, timeWindow: "15 minutes" },
    },
    // MOVO-125: reverse geocoding del GPS del wizard de envíos — PROTEGIDA (no está en
    // getPublicRoutes), a diferencia de /geocode y /places/*. Igual necesita este
    // limiter propio: requerir JWT no la protege de un usuario logueado disparando el
    // paso de "usar mi ubicación actual" en loop contra la Geocoding API de Google.
    {
      method: "POST",
      path: "/geocode/reverse",
      rateLimit: { max: 20, timeWindow: "15 minutes" },
    },
  ];
}
