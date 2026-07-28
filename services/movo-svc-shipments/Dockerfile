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
RUN npm ci

COPY shared/movo-shared shared/movo-shared
COPY services/movo-svc-shipments services/movo-svc-shipments

RUN npm run build --workspace=shared/movo-shared
RUN npm run build --workspace=services/movo-svc-shipments

# --- Stage 2: runtime ---
# Acá solo van las dependencias de producción y el resultado ya compilado.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/movo-shared/package.json shared/movo-shared/package.json
COPY services/movo-svc-shipments/package.json services/movo-svc-shipments/package.json
RUN npm ci --omit=dev

COPY --from=builder /app/shared/movo-shared/dist ./shared/movo-shared/dist
COPY --from=builder /app/services/movo-svc-shipments/dist ./services/movo-svc-shipments/dist

WORKDIR /app/services/movo-svc-shipments

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
