# Movo

Plataforma de logística distribuida P2P que conecta a personas que necesitan enviar un paquete con personas que ya están viajando esa ruta. Sin intermediarios centralizados: seguridad mediante criptografía asimétrica, precios dinámicos por algoritmos, y optimización de rutas.

Proyecto final de la cátedra Proyecto Final, Ingeniería en Sistemas de Información, UTN Facultad Regional Córdoba (2026).

## Equipo

| Integrante | Legajo |
|---|---|
| Ariza, Alena | 95359 |
| Bordino Blanche, Juan Cruz | 95008 |
| Dalmagro, Lucas | 94366 |
| Yorlano, Pedro | 95197 |
| Vergara, Tomás Ignacio | 94197 |

## Stack

| Capa | Tecnología |
|---|---|
| Mobile | React Native + Expo (iOS y Android) |
| Admin | Next.js |
| Backend | Node.js + Fastify + TypeScript |
| Servicio de precios y logística | Python + FastAPI |
| Base de datos | PostgreSQL 16 |
| Cache | Redis 7 |
| Optimización de rutas | Google OR-Tools (VRPTW) |
| Pagos | Mercado Pago (Auth & Capture, Split Payment) |
| Real-time | WebSocket |
| Infraestructura | AWS EC2 + Docker Compose |
| CI/CD | GitHub Actions |

## Estructura del repositorio

```
movo/
├── movo-mobile/                    # React Native + Expo (iOS y Android)
├── movo-admin/                     # Panel de administración - Next.js
├── gateway/                        # API Gateway - routing y auth de entrada
├── services/
│   ├── movo-svc-users/             # Node.js - Identidad, auth, KYC, reputación
│   ├── movo-svc-shipments/         # Node.js - Gestión de envíos y tracking
│   ├── movo-svc-payments/          # Node.js - Integración Mercado Pago
│   ├── movo-svc-pricing-logistics/ # FastAPI - Motor de precios y optimización de rutas
│   └── movo-svc-admin/             # Node.js - Reportes, disputas y soporte del panel admin
├── shared/                         # Librería interna - tipos, contratos, constantes
├── infra/                          # Docker Compose, plantillas CI, configs de entorno
├── .github/
│   └── workflows/
│       ├── ci-dev.yml              # Push a develop: build, test y deploy a staging
│       └── ci-prod.yml             # Push a main: build, test y deploy a producción
├── .gitignore
└── README.md
```

El código de la landing institucional vive en un repositorio aparte, sin dependencias con este monorepo.

## Cómo correr todo en local

El backend (gateway + los 5 microservicios) corre en Docker; `movo-admin` y `movo-mobile` corren nativos con sus propias herramientas (Next.js / Expo), no están dockerizados.

### 1. Prerequisitos

- Docker Desktop (o Docker Engine + Compose plugin) corriendo.
- Node.js 20 si vas a correr algún servicio suelto fuera de Docker (`npm run dev`).
- Python 3.12 si vas a tocar `movo-svc-pricing-logistics` fuera de Docker.

### 2. Levantar el backend completo con Docker Compose

Esta es la forma recomendada: levanta Postgres, Redis, los 5 microservicios, el gateway y el proxy nginx, todo buildeado desde el código fuente (no pullea nada de GHCR, así que no depende de que haya habido un deploy antes).

```bash
cd infra
cp .env.example .env                 # valores default ya sirven para local
./local-certs.sh                     # genera un cert self-signed (una sola vez)
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Con eso arriba:

- `https://localhost/health` → nginx → gateway (cert self-signed, el navegador/curl se va a quejar, es esperado: `curl -k`).
- `https://localhost/users/...`, `/shipments/...`, `/payments/...`, `/admin/...` → gateway → microservicio correspondiente. Todos menos `/users` requieren `Authorization: Bearer <jwt>` (el gateway devuelve 401 si falta).
- Cada servicio también queda publicado directo en su puerto para debuggear sin pasar por el gateway: `movo-svc-users` en `:3001`, `movo-svc-shipments` en `:3002`, `movo-svc-payments` en `:3003`, `movo-svc-admin` en `:3004`, `movo-svc-pricing-logistics` en `:3005`.

Para bajar todo: `docker compose -f docker-compose.yml -f docker-compose.local.yml down` (agregar `-v` si además querés borrar el volumen de Postgres y arrancar de cero).

Si solo querés los servicios de app sin el proxy (más rápido para iterar):

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml \
  --profile local up -d --build movo-svc-users movo-svc-shipments \
  movo-svc-payments movo-svc-admin movo-svc-pricing-logistics gateway \
  postgres redis
```

### 3. Iterar sobre un solo servicio (sin rebuildear la imagen en cada cambio)

Para desarrollo activo de un servicio puntual, es más rápido correrlo nativo con hot-reload y apuntarlo a Postgres/Redis de Docker:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.local.yml \
  up -d postgres redis

cd services/movo-svc-users        # o el servicio que estés tocando
cp .env.example .env
# editar .env: DATABASE_URL y REDIS_URL deben apuntar a localhost, no al
# nombre del servicio en la red de Docker (postgres/redis solo resuelven
# esos nombres *entre* contenedores)
npm install
npm run dev                       # tsx watch, hot-reload
```

Para `movo-svc-pricing-logistics` (Python):

```bash
cd services/movo-svc-pricing-logistics
cp .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn main:app --reload --port 8000
```

Para `gateway`: mismo flujo que un servicio Node (`cp .env.example .env`, `npm install`, `npm run dev`), pero sus `.env.example` apunta las URLs de los servicios upstream a `localhost:<puerto>` en vez de los nombres de Docker — solo funciona si esos servicios están publicados en esos puertos (por eso conviene levantarlos con `docker-compose.local.yml`, que ya los publica).

### 4. Verificar antes de pushear (lo que corre CI)

Por servicio Node (`gateway`, `services/movo-svc-*` salvo pricing-logistics):

```bash
npm run lint
npx tsc --noEmit
npm test
```

Para `movo-svc-pricing-logistics`:

```bash
ruff check .
mypy .
pytest
```

Y si querés confirmar que el `docker-compose.yml` real (el que se copia a la EC2) funciona de punta a punta, correlo local como en el paso 2 — es exactamente lo que corre `deploy-dev`/`deploy-prod`, solo que ahí pullea de GHCR en vez de buildear.

### 5. Variables de entorno

Cada servicio tiene su propio `.env.example` en su raíz (copiar a `.env`, nunca commitear el `.env`). `infra/.env.example` es el que usa `docker-compose.yml` para Postgres/nginx/y para inyectarles `DATABASE_URL`/`JWT_SECRET`/etc. a los contenedores. En dev/prod esas mismas variables las genera el workflow de CI/CD leyendo AWS Secrets Manager (`movo/<env>/app-secrets`), nunca viven en el repo.

## Flujo de trabajo

- **Branches**: GitHub Flow con capa `develop`. `main` (producción) y `develop` (staging) son permanentes. Trabajo en `feature/*`, `fix/*` o `hotfix/*`, nombradas `<tipo>/MOVO-<id>-<descripcion-corta>`.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/). Ej: `feat(payments): agregar flujo auth & capture`.
- **PRs**: se mergean a `develop` con squash merge. Todo PR mergeado a `develop` se despliega automáticamente a staging; `develop` → `main` despliega a producción.
- **Backlog**: gestionado en Linear, vinculado a branches y commits vía el ID de issue (`MOVO-xxx`).

## Documentación

La documentación no-código (actas, ADRs, entregables académicos, diagramas) vive en Google Drive bajo la convención de nombre `[Movo] NNN-Nombre del documento`. El código, su documentación técnica (Swagger/OpenAPI generado) y las migraciones de base de datos viven en este repositorio.

## Licencia

Proyecto académico, UTN Facultad Regional Córdoba. Sin licencia de distribución definida.
