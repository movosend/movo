import { existsSync } from "node:fs";
import Redis from "ioredis";
import { ApiError } from "@movo/shared";
import { createEmailProvider } from "../adapters/email-provider";
import { createPrismaClient } from "../plugins/db";
import { createSessionRepository } from "../repositories/session-repository";
import { createUserRepository } from "../repositories/user-repository";
import { AdminRolesLogger, AdminRolesServiceDeps, createAdminRolesService } from "../modules/admins/admin-roles.service";

/**
 * MOVO-290 (AC1): alta y baja del rol `admin` desde la terminal. Es la única forma de crear
 * el primer admin; después la gestión se hace desde el panel. Se corre dentro del contenedor,
 * igual que las migraciones (Postgres no expone puerto público, ADR-010):
 *
 *   docker compose run --rm -T movo-svc-users npm run admin:grant -- persona@movo.app
 *   docker compose run --rm -T movo-svc-users npm run admin:revoke -- persona@movo.app
 *
 * Vive en `src/` y no en una carpeta `scripts/` aparte porque la imagen de producción solo
 * trae `dist/` y no tiene `tsx`: tiene que compilarse con el resto del servicio.
 */

const USAGE = "Uso: npm run admin:grant -- <email> | npm run admin:revoke -- <email>";

/** Lo que queda en el log del servicio cuando la operación sale del script (fuera de alcance de la bitácora). */
const CLI_REQUESTER = "cli";

export interface AdminRoleCliOutput {
  out(message: string): void;
  err(message: string): void;
}

const consoleOutput: AdminRoleCliOutput = {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
};

/** Una línea JSON por evento, como el log de Fastify, así se lee igual en `docker logs`. */
function createJsonLogger(): AdminRolesLogger {
  const write = (level: string) => (obj: Record<string, unknown>, msg: string) => {
    console.log(JSON.stringify({ level, time: Date.now(), ...obj, msg }));
  };
  return { info: write("info"), warn: write("warn"), error: write("error") };
}

/**
 * Corre el comando y devuelve el código de salida. Recibe las dependencias armadas para que
 * los tests la llamen contra la base real sin levantar un proceso aparte.
 */
export async function runAdminRoleCli(
  argv: string[],
  deps: AdminRolesServiceDeps,
  output: AdminRoleCliOutput = consoleOutput
): Promise<number> {
  const [command, email, ...rest] = argv;
  if ((command !== "grant" && command !== "revoke") || !email || rest.length > 0) {
    output.err(USAGE);
    return 2;
  }

  const service = createAdminRolesService(deps);
  try {
    if (command === "grant") {
      const { admin, alreadyAdmin } = await service.grantAdmin(email, CLI_REQUESTER);
      output.out(
        alreadyAdmin
          ? `${admin.email} ya era admin (desde ${admin.grantedAt}). No se cambió nada.`
          : `Rol admin otorgado a ${admin.fullName} <${admin.email}>.`
      );
      return 0;
    }

    // El endpoint recibe el id (lo arma `svc-admin` desde la lista); a mano es más cómodo el email.
    const user = await createUserRepository(deps.db).findByEmail(email.trim());
    if (!user) {
      throw new ApiError(404, "USER_NOT_FOUND", "No existe un usuario con ese email.");
    }
    await service.revokeAdmin(user.id, CLI_REQUESTER);
    output.out(`Rol admin revocado a ${user.email}. Sus sesiones de panel quedaron cerradas.`);
    return 0;
  } catch (error) {
    if (error instanceof ApiError) {
      output.err(`Error (${error.code}): ${error.message}`);
      return 1;
    }
    throw error;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function readEmailProvider(): "console" | "resend" {
  const value = process.env.EMAIL_PROVIDER || "console";
  if (value !== "console" && value !== "resend") {
    throw new Error(`EMAIL_PROVIDER inválido: ${value}`);
  }
  return value;
}

async function main(): Promise<void> {
  // En local, el mismo `.env` que usa el servicio. En el contenedor no hay archivo: Compose
  // ya inyecta las variables.
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }

  const db = createPrismaClient(requireEnv("DATABASE_URL"));
  const redis = new Redis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: 3 });
  const emailProvider = createEmailProvider({
    EMAIL_PROVIDER: readEmailProvider(),
    ...(process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY } : {}),
    ...(process.env.EMAIL_FROM ? { EMAIL_FROM: process.env.EMAIL_FROM } : {}),
  });

  let exitCode = 1;
  try {
    exitCode = await runAdminRoleCli(process.argv.slice(2), {
      db,
      sessionRepository: createSessionRepository(redis),
      emailProvider,
      logger: createJsonLogger(),
    });
  } finally {
    await db.$disconnect();
    redis.disconnect();
  }
  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
