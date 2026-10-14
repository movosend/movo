# CLAUDE.md — services/movo-svc-admin

Estado de implementación de `movo-svc-admin`. Ver el `CLAUDE.md` de la raíz del repo para
contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada corta por US: qué se
hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-288 — Base del servicio: `/admin`, `x-user-*`, Prisma, bitácora y conflicto de interés

Deja la infraestructura común de todas las US de admin (MOVO-32/33/34/35/36/292/294), sin
endpoints de negocio salvo `GET /admin/audit-log`. El panel solo habla con `/admin/*`; este
servicio aplica la regla de conflicto, escribe la bitácora y llama a los endpoints internos del
servicio dueño (decisión 6 de MOVO-286).

- **Identidad por `x-user-*` (ADR-010)**: sin `@fastify/jwt` ni `JWT_SECRET`. El gateway exige
  el rol `admin` en todo `/admin` (que solo entra al JWT en una sesión de panel, MOVO-287);
  `utils/require-admin.ts` lo vuelve a chequear como defensa en profundidad.
- **Prisma con el schema `admin` (ADR-011)**, mismo molde que `svc-payments`. Primera migración
  escrita a mano (`prisma migrate diff --from-empty`): la tabla `admin.audit_log` y un trigger que
  rechaza `UPDATE`/`DELETE`/`TRUNCATE`, así la bitácora es de solo agregar filas en la base y no
  solo por convención. `adminId`/`targetId` sin FK (viven en otros schemas). Los tests no pueden
  limpiar la tabla: se aíslan con un `adminId` aleatorio. Con esto ningún servicio usa ya
  `scripts/run-migrations.sh`, que se borró. **Misma versión de Prisma que el resto de los
  servicios**: si npm la instala anidada en `services/movo-svc-admin/node_modules`, el binario no
  queda en `/app/node_modules/.bin/prisma`, que es la ruta que corre el deploy.
- **`app.audit.runAdminAction(input, action)`** (`modules/audit/audit.service.ts`) es el único
  camino de una escritura del panel: regla de conflicto → acción → **una** fila con el resultado.
  Si la regla o la acción fallan, la fila es `failed` con el código del error y el error se
  relanza: nunca queda `succeeded` algo que no ocurrió (AC5). Un rechazo por conflicto también se
  registra (rastro del intento). Brecha inversa aceptada: si la acción salió bien y el insert
  falla, se responde el resultado y queda un `error` en el log (`admin_audit_insert_failed`) con
  todo el contexto, porque no hay transacción entre servicios (ADR-001). `action` es texto libre:
  cada US define las suyas (`user.suspend`, `admin_role.revoke`...). `createdAt` lo fija la app en
  ms para que el cursor no saltee filas (gotcha del chat, MOVO-26).
- **Regla de conflicto** (`modules/audit/conflict-of-interest.ts`): `user`/`admin_role` comparan
  ids; `shipment` y `chat_report` consultan a `svc-shipments` y `user_report` a `svc-users` (los
  tres endpoints `/internal/.../parties` nacieron en esta US). Un receptor anterior (transferencia
  o rechazo) cuenta como parte. Falla cerrado: servicio caído → 502; objetivo inexistente → 404.
  Solo aplica a escrituras: leer sí puede.
- **Clientes internos** (`adapters/`): `createInternalClient` es la base (timeout de 5 s,
  `x-request-id` propagado por primera vez en el repo, 404 → `null`, red/5xx/forma inválida →
  502 `<SERVICIO>_SERVICE_UNAVAILABLE`, otro 4xx se relanza con su código). Cada US suma sus
  métodos en `users-client.ts`/`shipments-client.ts`/`payments-client.ts` (este último todavía
  sin ninguno). Se inyectan con `buildApp({ usersClient, ... })`; fakes en `test/fake-clients.ts`.
- **`GET /admin/audit-log`**: filtros `adminId`, `action`, `targetType`, `targetId`; cursor
  keyset `(createdAt, id)` con `{ items, nextCursor }` (`AuditLogPage` de `@movo/shared`), límite
  1-50. Sin UI todavía.
- Env: `USERS_/SHIPMENTS_/PAYMENTS_SERVICE_URL` con default al hostname de Compose (no hizo falta
  tocar `infra/docker-compose.yml`, solo sacar `JWT_SECRET`). `@fastify/env` y el error handler
  (formato `ApiError` + `requestId`) se registran por primera vez en este servicio. Cobertura con
  umbral de 70% de líneas.

Pendiente / fuera de alcance: endpoints de negocio (cada US de admin), UI de la bitácora,
`movo-admin` consumiendo `/admin/*` (MOVO-291), y la primera corrida de `prisma migrate deploy`
de este servicio en dev/prod (su fila vieja en `public.schema_migrations` queda como histórico).
