# Build de un paquete del workspace de npm (ver MOVO-67): el contexto es
# la raíz del repo, no esta carpeta, porque @movo/shared se resuelve como
# symlink de npm workspaces a shared/movo-shared y necesita estar en el
# mismo contexto de build. Se buildea con:
#   docker build -f gateway/Dockerfile .

# --- Stage 1: build ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/movo-shared/package.json shared/movo-shared/package.json
COPY gateway/package.json gateway/package.json
RUN npm ci

COPY shared/movo-shared shared/movo-shared
COPY gateway gateway

RUN npm run build --workspace=shared/movo-shared
RUN npm run build --workspace=gateway

# --- Stage 2: runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/movo-shared/package.json shared/movo-shared/package.json
COPY gateway/package.json gateway/package.json
RUN npm ci --omit=dev

COPY --from=builder /app/shared/movo-shared/dist ./shared/movo-shared/dist
COPY --from=builder /app/gateway/dist ./gateway/dist

WORKDIR /app/gateway

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
