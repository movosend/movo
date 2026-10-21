# Plan de testing

## Objetivo

Que ningún Pull Request se mergee a `develop` ni a `main` sin que sus tests pasen en verde, y que el equipo pueda medir cobertura real por sprint en vez de depender de buena voluntad. Este documento es el entregable de MOVO-69 y describe cómo quedó configurado el testing automatizado en el monorepo.

## Niveles de testing

- **Unitario**: funciones puras y lógica de servicio, con dependencias externas mockeadas cuando corresponde.
- **Integración**: contra dependencias reales (Postgres 16, Redis 7 en CI), sin mockear la base de datos. Verifica que un endpoint completo funcione end-to-end dentro del proceso del servicio.
- **E2E**: **fuera de alcance de esta US.** Queda como propuesta de ticket futuro (por ejemplo con Playwright para `movo-admin` o Detox para `movo-mobile`).

## Herramienta por nivel

| Paquete | Framework | Unitario / Integración | Notas |
| --- | --- | --- | --- |
| `gateway` | Fastify | Vitest + `app.inject()` | Reverse proxy, sin DB propia. |
| `services/movo-svc-users` | Fastify | Vitest + `app.inject()` | Tiene el ejemplo de integración con Postgres real (`test/users.count.integration.test.ts`). |
| `services/movo-svc-shipments` | Fastify | Vitest + `app.inject()` | Aún sin lógica de dominio real. |
| `services/movo-svc-payments` | Fastify | Vitest + `app.inject()` | Aún sin lógica de dominio real. |
| `services/movo-svc-admin` | Fastify | Vitest + `app.inject()` | Aún sin lógica de dominio real. |
| `services/movo-svc-pricing-logistics` | FastAPI | Pytest + `TestClient` | Cobertura con `pytest-cov`. |
| `movo-mobile` | Expo / React Native | Jest (`jest-expo`) + React Native Testing Library | No estaba contemplado en el issue original; se agregó por decisión del equipo. |
| `movo-admin` | Next.js | Vitest + Testing Library (`@testing-library/react`, jsdom) | Tampoco estaba contemplado en el issue original; se agregó por decisión del equipo. |

## Cobertura mínima acordada

- **55% de líneas** en `services/movo-svc-users` (`src/modules/**/*.service.ts` y `*.repository.ts`), y en `services/movo-svc-pricing-logistics` (`main.py`). Es el punto medio del rango 50-60% sugerido en el issue.
- `gateway` y los servicios `shipments`/`payments`/`admin` (Node) reportan cobertura pero **sin umbral estricto todavía**: son scaffolds sin lógica de dominio real, y exigir un porcentaje sobre código vacío no aporta nada. El umbral se activa cuando cada uno tenga su propio ejemplo de integración, siguiendo el patrón de `movo-svc-users`.
- `movo-mobile` y `movo-admin` tampoco tienen umbral estricto por ahora (paquetes nuevos, sin convención de carpetas todavía).
- Un umbral alto desde el sprint 1 produce tests escritos solo para satisfacer el número. Se prefiere un piso honesto que suba sprint a sprint, con análisis de tendencia documentado en cada informe (no solo el número).

## Quién revisa los resultados

**Supuesto a confirmar con el equipo** (no había un rol definido en el repo): el reviewer de cada PR valida que el check `tests-summary` esté en verde y revisa los números de cobertura impresos en el log de los jobs `node-services`/`python-service`/`mobile`/`admin-web` antes de aprobar. El tech lead hace seguimiento de la tendencia de cobertura sprint a sprint para el informe.

## Migraciones en CI

Todos los servicios Node migran con Prisma (ADR-011): cada uno tiene `prisma/migrations/` y el job `node-services` de `.github/workflows/pr-checks.yml` corre `npx prisma migrate deploy` antes de los tests, contra el Postgres efímero levantado como service container. El runner de SQL a mano (`scripts/run-migrations.sh`) se borró en MOVO-288, cuando `movo-svc-admin`, su último consumidor, adoptó Prisma.

## Patrón de ejemplo a copiar

`services/movo-svc-users/test/users.count.integration.test.ts` es el test de referencia: usa `app.inject()` contra el endpoint real `GET /users/count`, que consulta Postgres a través de `app.db` (sin mocks). Aísla los datos entre tests truncando la tabla en `beforeEach`, para evitar fallos intermitentes por orden de ejecución.

## Pendientes / acción de Sprint 0

Por decisión del equipo (y no del texto literal del issue MOVO-69), se mantuvo **Vitest + `app.inject()`** en vez de Jest + Supertest para los servicios Fastify y el gateway (ya estaban configurados y funcionando; migrarlos no aportaba valor), y se agregó testing a **`movo-mobile`** (Jest + React Native Testing Library) y a **`movo-admin`** (Vitest + Testing Library), ninguno de los dos cubierto explícitamente por el issue original. Esta decisión quedó documentada como comentario en el issue MOVO-69 de Linear. Queda **pendiente reflejarla también en la documentación de Sprint 0 del equipo** (fuera de este repositorio).

## Fuera de alcance

- Testing end-to-end (Playwright / Detox).
- Adopción de una herramienta de migraciones real (más allá de los archivos `.sql` planos).
- Umbral de cobertura estricto para `shipments`, `payments`, `movo-svc-admin`, `movo-mobile` y `movo-admin` — se define cuando tengan lógica de dominio/UI real.
