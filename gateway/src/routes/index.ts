import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import httpProxy from "@fastify/http-proxy";
import { EnvConfig } from "../config/env";
import {
  getServiceRoutes,
  getPublicRoutes,
  getRateLimitOverrides,
  isPublicRoute,
  API_PREFIX,
} from "../config/routes-map";

/**
 * MOVO-201: `@fastify/http-proxy` maneja el upgrade WebSocket sola (sin necesitar
 * `@fastify/websocket` acá), pero su `rewriteRequestHeaders` de default solo reenvía el
 * header `cookie` al upstream -- así que sin esto, `x-user-id`/`x-user-roles`/
 * `x-kyc-status`/`x-request-id` (ya inyectados por el `preHandler` de más abajo sobre
 * este mismo `request`, tanto para HTTP normal como para el upgrade) nunca llegan a
 * `svc-shipments` en una conexión WS, aunque sí lleguen en cualquier request HTTP normal
 * al mismo prefijo. `request.headers` en este punto es el MISMO objeto que ya mutó el
 * `preHandler` (misma request, no una copia) -- por eso alcanza con leerlo de nuevo acá.
 *
 * `authorization` va en esta misma lista (fix de review, PR #174): `rewriteRequestHeaders`
 * de `@fastify/http-proxy` recibe `wsClientOptions.headers` (`{}` por default), no
 * `request.headers` -- sin agregarlo acá, `authorizeRealtimeConnection` de `svc-shipments`
 * (que solo lee `Authorization`, no cae a `x-user-*`) rechaza con `4001` toda conexión que
 * pase por el gateway.
 */
const FORWARDED_IDENTITY_HEADERS = [
  "authorization",
  "x-user-id",
  "x-user-roles",
  "x-kyc-status",
  "x-request-id",
] as const;

function rewriteWebSocketRequestHeaders(
  headers: Record<string, string>,
  request: FastifyRequest
): Record<string, string> {
  const rewritten = { ...headers };
  for (const key of FORWARDED_IDENTITY_HEADERS) {
    const value = request.headers[key];
    if (typeof value === "string") {
      rewritten[key] = value;
    }
  }
  return rewritten;
}

/**
 * Clave de rate limit de un cliente demo: el id de la API key (`x-client-id`, ya
 * inyectado por el gateway) + la IP real del visitante que reenvía el servidor de
 * Next.js en `x-movo-client-ip`. Ese header solo se lee después de validar la key (el
 * servidor de Next es de confianza); sin él cuenta por la IP del propio servidor.
 */
function demoClientKey(request: FastifyRequest): string {
  const clientId = request.headers["x-client-id"];
  const visitorIp = request.headers["x-movo-client-ip"];
  const ip = typeof visitorIp === "string" && visitorIp.length > 0 && visitorIp.length <= 64 ? visitorIp : request.ip;
  return `${typeof clientId === "string" ? clientId : "unknown"}:${ip}`;
}

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
  const strictRateLimiters = new Map<string, { limiter: ReturnType<typeof app.rateLimit>; perUser: boolean }>();
  const rateLimitedRoutes = [
    ...getPublicRoutes().filter((r) => r.rateLimit),
    ...getRateLimitOverrides(),
  ];
  for (const route of rateLimitedRoutes) {
    const routeKey = `${route.method} ${route.path}`;
    // MOVO-255: `perUser` cuenta por `sub` del JWT. Ese limiter corre recién después de
    // `authenticate` (ver el preHandler), así que `request.user` ya está; el fallback a
    // IP es solo defensivo.
    const perUser = "perUser" in route && route.perUser === true;
    // Juegos (`auth: "apiKey"`): por cliente demo + IP del visitante, también después de
    // autenticar la key (ver `demoClientKey`).
    const perClient = "perClient" in route && route.perClient === true;
    strictRateLimiters.set(routeKey, {
      perUser: perUser || perClient,
      limiter: app.rateLimit({
        ...route.rateLimit!,
        keyGenerator: perClient
          ? (request) => `${routeKey}:${demoClientKey(request)}`
          : perUser
            ? (request) => `${routeKey}:user:${request.user?.sub ?? request.ip}`
            : (request) => `${routeKey}:${request.ip}`,
      }),
    });
  }

  // Límite de las rutas demo sin override propio (ej. `PUT /demo/pricing-game/sessions/:id`,
  // con parámetro en el path): 60/min por visitante, contador aparte del general.
  const demoGeneralLimiter = app.rateLimit({
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (request) => `demo-general:${demoClientKey(request)}`,
  });

  for (const route of serviceRoutes) {
    const preHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      // request.url incluye el prefijo /api/v1 con el que se registró este
      // plugin; getPublicRoutes() declara los paths sin ese prefijo (son
      // los mismos paths que describe el AC del ticket), así que hay que
      // sacarlo antes de comparar.
      const fullPath = request.url.split("?")[0];
      const path = fullPath.startsWith(API_PREFIX)
        ? fullPath.slice(API_PREFIX.length)
        : fullPath;
      // Ningún cliente puede mandar su propio `x-client-id`: solo lo inyecta el
      // gateway tras validar una API key (rutas demo, abajo).
      delete request.headers["x-client-id"];

      if (route.auth === "apiKey") {
        let clientId: string;
        try {
          clientId = await app.authenticateApiKey(request);
        } catch (error) {
          // Una key inválida cuenta contra el límite general por IP (el estricto por
          // cliente demo todavía no corrió, así que sigue siendo un solo limiter por
          // request): sin esto los 401 de /demo no tienen ningún tope.
          await generalLimiter.call(app, request, reply);
          throw error;
        }
        request.headers["x-client-id"] = clientId;
        const strict = strictRateLimiters.get(`${request.method.toUpperCase()} ${path}`);
        await (strict?.limiter ?? demoGeneralLimiter).call(app, request, reply);

        Object.keys(request.headers).forEach((key) => {
          if (key.toLowerCase().startsWith("x-user-")) {
            delete request.headers[key];
          }
        });
        // La key no viaja al upstream: ya cumplió su función acá.
        delete request.headers["x-api-key"];
        delete request.headers["authorization"];
        request.headers["x-request-id"] = request.requestId;
        return;
      }

      const publicRoute = isPublicRoute(request.method, path);

      // Rate limit: estricto si esta ruta puntual lo declara —pública (ej. login) o
      // protegida (ej. /users/me/photo/upload-url, MOVO-97)—, general en cualquier
      // otro caso. El lookup es independiente de si la ruta es pública: ver
      // `rateLimitedRoutes` más arriba.
      // MOVO-255: un limiter `perUser` se difiere hasta después de autenticar (sigue
      // siendo el único limiter del request, no se suma al general).
      const strict = strictRateLimiters.get(`${request.method.toUpperCase()} ${path}`);
      const deferredLimiter = strict?.perUser && !publicRoute ? strict.limiter : undefined;
      if (!deferredLimiter) {
        await (strict?.limiter ?? generalLimiter).call(app, request, reply);
      }

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

      if (deferredLimiter) {
        await deferredLimiter.call(app, request, reply);
      }

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
    };

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
    //
    // MOVO-201: `websocket`/`wsClientOptions` solo se pasan cuando la ruta los pide
    // (ver el comentario de `rewriteWebSocketRequestHeaders` más arriba) -- dos
    // llamadas a `register` en vez de armar un solo objeto con spread condicional
    // porque el tipo de `@fastify/http-proxy` es una unión discriminada por
    // `websocket` (`true` vs `false | never`) que TypeScript no resuelve bien
    // cuando esa propiedad llega de un spread condicional en vez de estar escrita
    // literal en cada llamada.
    if (route.websocket) {
      await app.register(httpProxy, {
        upstream: route.upstream,
        prefix: route.prefix,
        rewritePrefix: route.prefix,
        websocket: true,
        // Los types de @fastify/http-proxy (`wsClientOptions?: ClientOptions &
        // {queryString}`) no declaran `rewriteRequestHeaders`, pese a que la
        // implementación real sí lo lee (`this.wsClientOptions.rewriteRequestHeaders`
        // en su código fuente, `node_modules/@fastify/http-proxy/index.js`) -- gap
        // conocido de sus `.d.ts`, no error nuestro. `any` puntual y comentado,
        // no en toda la opción de registro.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wsClientOptions: { rewriteRequestHeaders: rewriteWebSocketRequestHeaders } as any,
        preHandler,
      });
    } else {
      await app.register(httpProxy, {
        upstream: route.upstream,
        prefix: route.prefix,
        rewritePrefix: route.prefix,
        preHandler,
      });
    }
  }
}
