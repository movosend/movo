# Build de un paquete del workspace de npm (ver MOVO-67): el contexto es
# la raíz del repo, no esta carpeta, porque @movo/shared se resuelve como
# symlink de npm workspaces a shared/movo-shared y necesita estar en el
# mismo contexto de build. Se buildea con:
#   docker build -f services/movo-svc-shipments/Dockerfile .

# --- Stage 1: build ---
# Acá SÍ necesitamos las devDependencies (typescript, tsx, etc.) para compilar.
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/movo-shared/package.json shared/movo-shared/package.json
COPY services/movo-svc-shipments/package.json services/movo-svc-shipments/package.json
# --ignore-scripts: el postinstall (`prisma generate`) necesita prisma/schema.prisma,
# que todavía no existe en esta capa (solo se copiaron los package.json, para que la
# capa de deps quede cacheada aparte del código fuente). Se corre explícito más abajo,
# ya con el código fuente copiado.
RUN npm ci --ignore-scripts

COPY shared/movo-shared shared/movo-shared
COPY services/movo-svc-shipments services/movo-svc-shipments

RUN npm run build --workspace=shared/movo-shared

WORKDIR /app/services/movo-svc-shipments
RUN npx prisma generate

WORKDIR /app
RUN npm run build --workspace=services/movo-svc-shipments

# --- Stage 2: runtime ---
# Acá solo van las dependencias de producción y el resultado ya compilado.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/movo-shared/package.json shared/movo-shared/package.json
COPY services/movo-svc-shipments/package.json services/movo-svc-shipments/package.json
# --ignore-scripts: mismo motivo que en el stage de build -- acá tampoco está
# prisma/schema.prisma en este punto. `prisma` es dependency (no devDependency)
# a propósito: la CLI viaja en la imagen de producción para poder correr
# `docker compose run --rm movo-svc-shipments npx prisma migrate deploy` contra
# la EC2 real en el deploy (Postgres no expone puerto público, ADR-010 -- no hay
# forma de correr `prisma migrate deploy` desde afuera del contenedor).
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/shared/movo-shared/dist ./shared/movo-shared/dist
COPY --from=builder /app/services/movo-svc-shipments/dist ./services/movo-svc-shipments/dist
COPY services/movo-svc-shipments/prisma.config.ts services/movo-svc-shipments/prisma.config.ts
COPY services/movo-svc-shipments/prisma services/movo-svc-shipments/prisma

WORKDIR /app/services/movo-svc-shipments

EXPOSE 3000

# timeout=10s y no 5s: el pool de Postgres corta las queries a los 5s
# (statement_timeout/query_timeout, mismo criterio que MOVO-85 en svc-users).
# Si Postgres acepta conexiones pero no responde, el check tarda esos 5s — con
# el timeout en 5s Docker mataba el wget justo en el límite. Si está caído de
# verdad (rechaza la conexión) falla al toque.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
