import { FastifyInstance } from "fastify";
import httpProxy from "@fastify/http-proxy";
import { EnvConfig } from "../config/env";
import {
  getServiceRoutes,
  getPublicRoutes,
  getRateLimitOverrides,
  isPublicRoute,
  API_PREFIX,
} from "../config/routes-map";

// Sin fastify-plugin a propósito: este plugin no necesita exponer nada al
// padre (a diferencia de auth.ts o rate-limit.ts), así que mantiene su
// propio contexto encapsulado — eso es lo que permite que el `prefix`
// ("/api/v1") pasado al registrarlo se aplique correctamente a sus rutas.
export default async function routesPlugin(
  app: FastifyInstance,
  opts: { env: EnvConfig }
) {
  const serviceRoutes = getServiceRoutes(opts.env);

  // app.rateLimit(opts) arma un contador nuevo cada vez que se llama — hay
  // que crearlo una sola vez acá (setup) y reusar la misma instancia en cada
  // request, si no el conteo nunca se acumula entre requests.
  //
  // Se aplica exactamente UN limitador por request (el general acá abajo,
  // o el estricto de una ruta puntual si lo tiene): @fastify/rate-limit
  // marca un flag interno la primera vez que corre en un request y no
  // vuelve a chequear — si intentáramos aplicar ambos (general + estricto)
  // al mismo request, el segundo chequeo se ignoraría en silencio.
  // MOVO-72: bug encontrado al agregar el segundo rate limit estricto (/kyc/session,
  // misma config {max:5, timeWindow:"15 minutes"} que /auth/login) — `@fastify/rate-limit`
  // en modo decorator (`app.rateLimit(opts)`, la forma en que se usa acá) siempre arma
  // el namespace del store con `routeInfo: {}` fijo (ver `createLimiterArgs` en la
  // librería), así que la clave real en Redis termina siendo
  // `fastify-rate-limit-undefinedundefined-<ip>` para TODOS los limiters creados así,
  // sin importar su `max`/`timeWindow` — general, login y kyc-session compartían un
  // solo contador por IP (confirmado con `redis-cli keys`). Un `keyGenerator` explícito
  // por limiter es la única forma de distinguirlos con esta API (routeInfo no es
  // configurable desde afuera de la librería).
  const generalLimiter = app.rateLimit({
    max: opts.env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    keyGenerator: (request) => `general:${request.ip}`,
  });

  // Union de dos fuentes: rutas públicas con rate limit propio (`getPublicRoutes()`,
  // ej. /auth/login) y rutas PROTEGIDAS con rate limit propio (`getRateLimitOverrides()`,
  // MOVO-97: /users/me/photo/upload-url exige JWT pero igual necesita un límite estricto
  // — emitir presigned URLs es la puerta de entrada a escribir en el bucket de S3). El
  // lookup en el preHandler es el mismo para las dos: por `method + path`, sin importar
  // si la ruta es pública o no.
  const strictRateLimiters = new Map<string, ReturnType<typeof app.rateLimit>>();
  const rateLimitedRoutes = [
    ...getPublicRoutes().filter((r) => r.rateLimit),
    ...getRateLimitOverrides(),
  ];
  for (const route of rateLimitedRoutes) {
    const routeKey = `${route.method} ${route.path}`;
    strictRateLimiters.set(
      routeKey,
      app.rateLimit({
        ...route.rateLimit!,
        keyGenerator: (request) => `${routeKey}:${request.ip}`,
      })
    );
  }

  for (const route of serviceRoutes) {
    await app.register(httpProxy, {
      upstream: route.upstream,
      prefix: route.prefix,
      // Sin rewrite: el path que expone cada microservicio (ej. `/auth/register`
      // en movo-svc-users) es el mismo que expone el gateway bajo `/api/v1`, ya que
      // cada servicio también se publica directo en su puerto para debug local (ver
      // README) y genera su propio Swagger documentando esos paths. `rewritePrefix:
      // "/"` (como estaba antes) le sacaba el prefijo del módulo (`/auth`, `/users`)
      // al reenviar — el upstream nunca lo esperó así, así que TODO endpoint de
      // movo-svc-users devolvía 404 al pasar por acá (nadie lo detectó porque el
      // test suite del gateway pega contra un stub que responde 200 a cualquier
      // path, y el de movo-svc-users llama las rutas directo con `app.inject()`,
      // sin gateway de por medio). `rewritePrefix: route.prefix` es un no-op
      // intencional: matchea `prefix` y lo vuelve a poner igual, el path llega
      // intacto al upstream.
      rewritePrefix: route.prefix,
      preHandler: async (request, reply) => {
        // request.url incluye el prefijo /api/v1 con el que se registró este
        // plugin; getPublicRoutes() declara los paths sin ese prefijo (son
        // los mismos paths que describe el AC del ticket), así que hay que
        // sacarlo antes de comparar.
        const fullPath = request.url.split("?")[0];
        const path = fullPath.startsWith(API_PREFIX)
          ? fullPath.slice(API_PREFIX.length)
          : fullPath;
        const publicRoute = isPublicRoute(request.method, path);

        // Rate limit: estricto si esta ruta puntual lo declara —pública (ej. login) o
        // protegida (ej. /users/me/photo/upload-url, MOVO-97)—, general en cualquier
        // otro caso. El lookup es independiente de si la ruta es pública: ver
        // `rateLimitedRoutes` más arriba.
        const strictLimiter = strictRateLimiters.get(`${request.method.toUpperCase()} ${path}`);
        await (strictLimiter ?? generalLimiter).call(app, request, reply);

        if (publicRoute) {
          // Ruta pública: solo limpiar headers falsificados y propagar request ID
          Object.keys(request.headers).forEach((key) => {
            if (key.toLowerCase().startsWith("x-user-")) {
              delete request.headers[key];
            }
          });
          request.headers["x-request-id"] = request.requestId;
          return;
        }

        // Ruta protegida: autenticar, validar rol (si el prefijo lo exige), inyectar identidad
        await app.authenticate(request, reply);

        if (route.allowedRoles && route.allowedRoles.length > 0) {
          await app.authorize(route.allowedRoles)(request, reply);
        }

        // Limpiar headers x-user-* del cliente (defensa en profundidad)
        Object.keys(request.headers).forEach((key) => {
          if (key.toLowerCase().startsWith("x-user-")) {
            delete request.headers[key];
          }
        });

        // Inyectar identidad desde el token
        request.headers["x-user-id"] = request.user!.sub;
        request.headers["x-user-roles"] = request.user!.roles.join(",");
        request.headers["x-kyc-status"] = request.user!.kycStatus;
        request.headers["x-request-id"] = request.requestId;
      },
    });
  }
}
