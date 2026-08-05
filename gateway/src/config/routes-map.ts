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

    // webhooks service
    {
      prefix: "/webhooks",
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

    // webhooks
    { method: "POST", path: "/webhooks/didit" },
  ];
}

export function isPublicRoute(method: string, path: string): PublicRoute | undefined {
  return getPublicRoutes().find(
    (r) => r.method === method.toUpperCase() && r.path === path
  );
}
