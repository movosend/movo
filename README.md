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
│       └── ci.yml                  # Pipeline único - detecta qué servicio cambió
├── .gitignore
└── README.md
```

El código de la landing institucional vive en un repositorio aparte, sin dependencias con este monorepo.


> Completar con los pasos reales una vez definida la configuración de Sprint 1 (Docker Compose, variables de entorno por servicio, seed de base de datos).

```bash
git clone https://github.com/movo/movo.git
cd movo
cp infra/.env.example .env
docker compose -f infra/docker-compose.yml up -d
```

Cada servicio en `services/` tiene su propio `.env.example` en la raíz del servicio, que debe copiarse a `.env` con los valores locales. Los secretos nunca se commitean: en local viven en `.env` (ignorado por git), en dev/prod en AWS Secrets Manager.
## Flujo de trabajo

- **Branches**: GitHub Flow con capa `develop`. `main` (producción) y `develop` (staging) son permanentes. Trabajo en `feature/*`, `fix/*` o `hotfix/*`, nombradas `<tipo>/MOVO-<id>-<descripcion-corta>`.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/). Ej: `feat(payments): agregar flujo auth & capture`.
- **PRs**: se mergean a `develop` con squash merge. Todo PR mergeado a `develop` se despliega automáticamente a staging; `develop` → `main` despliega a producción.
- **Backlog**: gestionado en Linear, vinculado a branches y commits vía el ID de issue (`MOVO-xxx`).

## Documentación

La documentación no-código (actas, ADRs, entregables académicos, diagramas) vive en Google Drive bajo la convención de nombre `[Movo] NNN-Nombre del documento`. El código, su documentación técnica (Swagger/OpenAPI generado) y las migraciones de base de datos viven en este repositorio.

## Licencia

Proyecto académico, UTN Facultad Regional Córdoba. Sin licencia de distribución definida.
