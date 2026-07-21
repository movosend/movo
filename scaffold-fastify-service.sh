#!/usr/bin/env bash
#
# scaffold-fastify-service.sh
#
# Crea la estructura base de un microservicio Fastify de Movo e instala
# las dependencias comunes (fastify, jwt, swagger, pg, redis, etc).
#
# Uso:
#   ./scaffold-fastify-service.sh <nombre-servicio> [modulo-inicial]
#
# Ejemplos:
#   ./scaffold-fastify-service.sh movo-svc-users users
#   ./scaffold-fastify-service.sh movo-svc-shipments shipments
#   ./scaffold-fastify-service.sh movo-svc-payments payments
#   ./scaffold-fastify-service.sh movo-svc-admin admin
#
# Correrlo desde la raíz del monorepo (donde está services/).

set -euo pipefail

SERVICE_NAME="${1:-}"
MODULE_NAME="${2:-}"

if [ -z "$SERVICE_NAME" ]; then
  echo "Error: falta el nombre del servicio."
  echo "Uso: ./scaffold-fastify-service.sh <nombre-servicio> [modulo-inicial]"
  exit 1
fi

SERVICE_DIR="services/${SERVICE_NAME}"

if [ -d "$SERVICE_DIR" ]; then
  echo "Error: ${SERVICE_DIR} ya existe. Borralo primero o elegí otro nombre."
  exit 1
fi

echo "==> Creando estructura de ${SERVICE_NAME} en ${SERVICE_DIR}"

mkdir -p "${SERVICE_DIR}/src/config"
mkdir -p "${SERVICE_DIR}/src/plugins"
mkdir -p "${SERVICE_DIR}/src/types"
mkdir -p "${SERVICE_DIR}/migrations"
mkdir -p "${SERVICE_DIR}/test"

if [ -n "$MODULE_NAME" ]; then
  mkdir -p "${SERVICE_DIR}/src/modules/${MODULE_NAME}"
fi

touch "${SERVICE_DIR}/migrations/.gitkeep"

cd "$SERVICE_DIR"

echo "==> npm init"
npm init -y > /dev/null

echo "==> Instalando dependencias runtime"
npm install fastify @fastify/env @fastify/jwt @fastify/swagger @fastify/swagger-ui pg ioredis

echo "==> Instalando dependencias de desarrollo"
npm install -D typescript @types/node @types/pg tsx vitest

echo "==> Generando tsconfig.json"
# Se escribe a mano en vez de usar `tsc --init` con flags: --init no acepta
# include/exclude por CLI, y sin esos campos tsc incluye por default TODOS
# los .ts del proyecto (test/ incluido), lo cual choca contra rootDir=src.
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
EOF

# --- src/config/env.ts ---
cat > src/config/env.ts << 'EOF'
export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
}

export const envSchema = {
  type: "object",
  required: ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"],
  properties: {
    PORT: { type: "number", default: 3000 },
    DATABASE_URL: { type: "string" },
    REDIS_URL: { type: "string" },
    JWT_SECRET: { type: "string" },
  },
};
EOF

# --- src/plugins/db.ts ---
cat > src/plugins/db.ts << 'EOF'
import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";

export default fp(async (app: FastifyInstance) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  app.decorate("db", pool);

  app.addHook("onClose", async () => {
    await pool.end();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}
EOF

# --- src/plugins/redis.ts ---
cat > src/plugins/redis.ts << 'EOF'
import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import Redis from "ioredis";

export default fp(async (app: FastifyInstance) => {
  const redis = new Redis(process.env.REDIS_URL as string);

  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    redis.disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}
EOF

# --- src/plugins/auth.ts ---
cat > src/plugins/auth.ts << 'EOF'
import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";

export default fp(async (app: FastifyInstance) => {
  app.register(jwt, {
    secret: process.env.JWT_SECRET as string,
  });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
EOF

# --- src/app.ts ---
cat > src/app.ts << 'EOF'
import Fastify, { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(swagger, {
    openapi: {
      info: {
        title: "SERVICE_NAME_PLACEHOLDER",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(dbPlugin);
  app.register(redisPlugin);
  app.register(authPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  // Registrar rutas de módulos acá, ej:
  // app.register(usersRoutes, { prefix: "/users" });

  return app;
}
EOF
sed -i.bak "s/SERVICE_NAME_PLACEHOLDER/${SERVICE_NAME}/" src/app.ts && rm src/app.ts.bak

# --- src/index.ts ---
cat > src/index.ts << 'EOF'
import { buildApp } from "./app";

const app = buildApp();

const port = Number(process.env.PORT) || 3000;

app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
EOF

npm install fastify-plugin

# --- módulo inicial opcional ---
if [ -n "$MODULE_NAME" ]; then
  MODULE_DIR="src/modules/${MODULE_NAME}"

  # Capitalizar la primera letra sin depender de ${VAR^} (no existe en Bash 3.2,
  # la versión que trae macOS por default). Compatible con cualquier Bash/POSIX.
  MODULE_NAME_CAP=$(printf '%s' "$MODULE_NAME" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')

  cat > "${MODULE_DIR}/${MODULE_NAME}.schema.ts" << EOF
export const ${MODULE_NAME}Schemas = {
  // Definir schemas de request/response acá (usados también para el Swagger generado)
};
EOF

  cat > "${MODULE_DIR}/${MODULE_NAME}.repository.ts" << EOF
import { Pool } from "pg";

export function create${MODULE_NAME_CAP}Repository(db: Pool) {
  return {
    // queries acá
  };
}
EOF

  cat > "${MODULE_DIR}/${MODULE_NAME}.service.ts" << EOF
export function create${MODULE_NAME_CAP}Service() {
  return {
    // lógica de negocio acá
  };
}
EOF

  cat > "${MODULE_DIR}/${MODULE_NAME}.routes.ts" << EOF
import { FastifyInstance } from "fastify";

export default async function ${MODULE_NAME}Routes(app: FastifyInstance) {
  app.get("/", async () => {
    return { module: "${MODULE_NAME}" };
  });
}
EOF
fi

# --- .env.example ---
cat > .env.example << 'EOF'
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/movo
REDIS_URL=redis://localhost:6379
JWT_SECRET=changeme
EOF

# --- Dockerfile ---
cat > Dockerfile << 'EOF'
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
EOF

# --- .gitignore local (además del raíz del monorepo) ---
cat > .gitignore << 'EOF'
node_modules/
dist/
.env
*.log
EOF

# --- test de ejemplo ---
cat > test/health.test.ts << 'EOF'
import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../src/app";

describe("GET /health", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it("responde status ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });
});
EOF

# --- package.json scripts ---
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json'));
pkg.scripts = {
  ...pkg.scripts,
  dev: 'tsx watch src/index.ts',
  build: 'tsc',
  start: 'node dist/index.js',
  test: 'vitest run'
};
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

cd - > /dev/null

echo ""
echo "==> Listo. ${SERVICE_DIR} scaffoldeado."
echo "    Revisá src/app.ts y completá el título del servicio si hace falta."
echo "    Para correrlo: cd ${SERVICE_DIR} && cp .env.example .env && npm run dev"
