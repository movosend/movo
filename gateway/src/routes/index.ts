import { FastifyInstance } from "fastify";
import httpProxy from "@fastify/http-proxy";
import { EnvConfig } from "../config/env";
import { getServiceRoutes, getPublicRoutes, isPublicRoute, API_PREFIX } from "../config/routes-map";

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
  const generalLimiter = app.rateLimit({
    max: opts.env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
  });

  const strictRateLimiters = new Map<string, ReturnType<typeof app.rateLimit>>();
  for (const publicRoute of getPublicRoutes()) {
    if (publicRoute.rateLimit) {
      strictRateLimiters.set(
        `${publicRoute.method} ${publicRoute.path}`,
        app.rateLimit(publicRoute.rateLimit)
      );
    }
  }

  for (const route of serviceRoutes) {
    await app.register(httpProxy, {
      upstream: route.upstream,
      prefix: route.prefix,
      rewritePrefix: "/",
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

        // Rate limit: estricto si esta ruta puntual lo declara (ej. login),
        // general en cualquier otro caso.
        const strictLimiter = publicRoute?.rateLimit
          ? strictRateLimiters.get(`${publicRoute.method} ${publicRoute.path}`)
          : undefined;
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
