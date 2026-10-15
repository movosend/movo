import Redis from "ioredis";
import envSchema from "env-schema";
import { ApiError } from "@movo/shared";
import { envSchema as configEnvSchema } from "../config/env";
import { createEmailProvider, EmailProviderConfig } from "../adapters/email-provider";
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
  if ((command !== "grant" && command !== "revoke") || !email?.trim() || rest.length > 0) {
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

type AdminRoleCliConfig = EmailProviderConfig & {
  DATABASE_URL: string;
  REDIS_URL?: string;
};

/** Reutiliza las definiciones del servicio y exige solo las dependencias del comando. */
export function readAdminRoleCliConfig(
  command: string,
  data: Record<string, unknown> = process.env,
  dotenv = true
): AdminRoleCliConfig {
  const keys = ["DATABASE_URL", "REDIS_URL", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"] as const;
  return envSchema<AdminRoleCliConfig>({
    schema: {
      type: "object",
      required: command === "revoke" ? ["DATABASE_URL", "REDIS_URL"] : ["DATABASE_URL"],
      properties: Object.fromEntries(keys.map((key) => [key, configEnvSchema.properties[key]])),
    },
    dotenv,
    data,
  });
}

async function main(): Promise<void> {
  const [command, email, ...rest] = process.argv.slice(2);
  if ((command !== "grant" && command !== "revoke") || !email?.trim() || rest.length > 0) {
    consoleOutput.err(USAGE);
    process.exitCode = 2;
    return;
  }
  const config = readAdminRoleCliConfig(command);
  // Valida las credenciales del proveedor antes de abrir conexiones.
  const emailProvider = createEmailProvider(config);
  const db = createPrismaClient(config.DATABASE_URL);
  let redis: Redis | undefined;

  let exitCode = 1;
  try {
    if (command === "revoke" && config.REDIS_URL) {
      redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
    }
    exitCode = await runAdminRoleCli(process.argv.slice(2), {
      db,
      ...(redis ? { sessionRepository: createSessionRepository(redis) } : {}),
      emailProvider,
      logger: createJsonLogger(),
    });
  } finally {
    try {
      await db.$disconnect();
    } finally {
      redis?.disconnect();
    }
  }
  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
