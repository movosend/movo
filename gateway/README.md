# movo-api-gateway

Punto de entrada único del backend. Valida identidad (JWT), aplica autorización por rol,
rate limiting, y reenvía cada request al microservicio interno correspondiente. Ningún
microservicio implementa autenticación por su cuenta: todos confían en los headers que
inyecta el gateway.

Implementa la US MOVO-68 (middleware de autenticación, autorización por rol y rate
limiting). Ver también el README raíz del monorepo para cómo levantar el resto del
backend en Docker.

## Por qué existe

Sin un gateway, cada microservicio (`movo-svc-users`, `movo-svc-shipments`, etc.)
tendría que reimplementar "¿este token es válido? ¿quién es este usuario? ¿tiene el rol
que necesito?". Eso duplica lógica de seguridad crítica en varios lugares — más
superficie para bugs. Acá se valida una sola vez, y el resultado se propaga hacia adentro
mediante headers HTTP.

Los servicios internos **no exponen puertos al exterior**: solo el gateway es alcanzable
desde afuera de la red Docker. Esa es la base de la limitación aceptada que se documenta
más abajo.

## Flujo de una request protegida

```
Cliente
  │  GET /api/v1/shipments/123
  │  Authorization: Bearer <jwt>
  ▼
┌─────────────────────────────────────────────────────────┐
│ gateway                                                  │
│                                                           │
│ 1. error-handler:   asigna x-request-id                  │
│ 2. routes:          ¿"/shipments/123" es ruta pública?   │
│                      no → sigue                          │
│ 3. rate-limit:      límite general por IP (Redis) —       │
│                     o el estricto de esa ruta, si tiene   │
│ 4. auth.authenticate: ¿el JWT es válido?                 │
│ 5. auth.authorize:    ¿tiene el rol requerido? (si aplica)│
│ 6. routes:          limpia cualquier x-user-* del cliente │
│                     inyecta x-user-id / x-user-roles /    │
│                     x-kyc-status desde el JWT verificado  │
└─────────────────────────────────────────────────────────┘
  │  GET /123
  │  x-user-id: <sub del token>
  │  x-user-roles: sender,carrier
  │  x-kyc-status: approved
  ▼
movo-svc-shipments (solo alcanzable desde la red interna)
```

Todo el ruteo a microservicios queda expuesto bajo el prefijo `/api/v1` (ej.
`/api/v1/shipments/...`, `/api/v1/auth/login`). `GET /health` es la única
excepción a propósito: no se versiona porque es el endpoint que consultan el
healthcheck de Docker y el load balancer.

Este sprint (MOVO-68) solo están conectados `movo-svc-users` (`/api/v1/auth`,
`/api/v1/users`) y `movo-svc-shipments` (`/api/v1/shipments`) — son los únicos
servicios con lógica viva. `movo-svc-payments` y `movo-svc-admin` quedan
comentados en `routes-map.ts`, listos para descomentar cuando esos servicios
estén implementados.

Si cualquier paso falla, el `error-handler` responde siempre con el mismo formato
(`ApiError` de `@movo/shared`), sin filtrar stack traces ni mensajes internos.

## Estructura

```
src/
├── app.ts                    # Arma la instancia de Fastify y registra todos los plugins
├── index.ts                  # Entry point: levanta el server
├── config/
│   ├── env.ts                # Lee y valida variables de entorno
│   └── routes-map.ts         # Mapa declarativo de rutas (ver abajo)
├── plugins/
│   ├── error-handler.ts      # Manejador de errores central + x-request-id
│   ├── auth.ts               # Decorators authenticate / authorize
│   ├── redis.ts              # Conexión a Redis (store de rate-limit)
│   └── rate-limit.ts         # @fastify/rate-limit con Redis como store
└── routes/
    └── index.ts              # Registra el proxy hacia cada microservicio
```

## El mapa de rutas (`config/routes-map.ts`)

Es el archivo que más se va a tocar entre distintos devs, así que tiene una convención
explícita para evitar conflictos de merge y errores de seguridad.

Dos listas separadas:

- **`getServiceRoutes()`**: a qué microservicio se reenvía cada prefijo (`/shipments` →
  `movo-svc-shipments`, etc.), y opcionalmente qué roles puede exigir ese prefijo
  (`allowedRoles`).
- **`getPublicRoutes()`**: lista explícita de endpoints públicos, por **método + path
  exacto** (no por prefijo).

**Por qué match exacto y no por prefijo:** si marcáramos todo `/auth` como público,
cualquier endpoint nuevo que se agregue ahí en el futuro (ej. `GET /auth/sessions`)
heredaría el flag público sin que nadie lo haya decidido. Con match exacto, **toda ruta
nueva es protegida por defecto** — para hacerla pública hay que agregarla a la lista a
propósito.

Al agregar un endpoint público nuevo: sumá una línea al final de `getPublicRoutes()`, sin
reordenar las existentes. Al agregar un microservicio nuevo: sumá un bloque a
`getServiceRoutes()`, un objeto por servicio.

## Autenticación y autorización (`plugins/auth.ts`)

- `app.authenticate`: valida el header `Authorization: Bearer <token>` contra
  `verifyAccessToken` de `@movo/shared`. Si falta o es inválido, corta con `401` y
  código `AUTH_TOKEN_INVALID`. Si expiró, corta con `401` y código `AUTH_TOKEN_EXPIRED`
  — un código distinto a propósito, para que el cliente pueda distinguir "refrescá el
  token automáticamente" de "mandá al usuario a loguearse de nuevo".
- `app.authorize(roles)`: preHandler reutilizable que exige que el usuario autenticado
  tenga alguno de los roles indicados. Devuelve `403` con código `AUTH_FORBIDDEN` si no
  cumple.

## Rate limiting (`plugins/redis.ts` + `plugins/rate-limit.ts`)

Usa Redis como store (no en memoria): si el gateway se reinicia, el conteo de requests
por IP sobrevive. Dos niveles, aplicados por `routes/index.ts` (nunca los dos a la vez
sobre el mismo request — `@fastify/rate-limit` solo corre un chequeo por request):

- **General**: se aplica a cualquier ruta que no tenga un límite propio. Configurable vía
  `RATE_LIMIT_MAX` (default 200 req/minuto).
- **Estricto**: declarado por ruta en `getPublicRoutes()` (`config/routes-map.ts`). Hoy
  solo `POST /auth/login` lo tiene (5 intentos cada 15 minutos por IP), para que un
  intento de fuerza bruta contra contraseñas no pueda esconderse detrás del límite
  general. Al superarse, responde `429` con código `RATE_LIMIT_EXCEEDED`.

## Limitación aceptada: confianza en la red interna

Los microservicios internos confían en los headers `x-user-id` / `x-user-roles` /
`x-kyc-status` sin volver a verificar nada, porque asumen que solo el gateway puede
alcanzarlos (red interna de Docker, sin puertos expuestos afuera). **Si un atacante
llega a tener acceso a esa red interna, este modelo de confianza cae.** Es una decisión
consciente y aceptada para el alcance de este proyecto, documentada acá y en el ADR
correspondiente (documentación no-código del proyecto, fuera de este repositorio).

## Variables de entorno

Ver `.env.example`. Nunca se commitea un `.env` real — en dev/prod, esas variables las
inyecta el pipeline de CI/CD leyendo un secret manager, no viven en el repo.

| Variable | Para qué |
|---|---|
| `PORT` | Puerto donde escucha el gateway |
| `JWT_SECRET` | Secreto para verificar la firma de los access tokens |
| `REDIS_URL` | Conexión a Redis (store del rate limiter) |
| `USERS_SERVICE_URL` / `SHIPMENTS_SERVICE_URL` / `PAYMENTS_SERVICE_URL` / `ADMIN_SERVICE_URL` | URLs internas de cada microservicio |
| `RATE_LIMIT_MAX` | Límite de requests por IP por minuto |

## Correr en local

```bash
cp .env.example .env
npm install
npm run dev        # tsx watch, hot-reload
```

Necesita Redis corriendo y accesible en `REDIS_URL`, y al menos los microservicios que
estén vivos apuntados en sus URLs correspondientes (ver el README raíz del monorepo para
levantar todo con Docker Compose).

## Tests

```bash
npm test
```

Los tests de integración levantan un servidor HTTP mínimo en memoria como "doble" de un
microservicio (no pegan contra servicios reales), y firman tokens JWT reales con
`signAccessToken` de `@movo/shared` para simular clientes autenticados. Cubren: request
sin token, token válido, token expirado, token malformado, header de identidad
falsificado por el cliente, y falta de rol requerido.

Requieren `REDIS_URL` apuntando a un Redis real corriendo (en CI ya está provisionado
como servicio del job; en local, levantalo con Docker o Homebrew).

## Documentación de la API

Con el server levantado en modo dev, Swagger UI queda disponible en `/docs`.
