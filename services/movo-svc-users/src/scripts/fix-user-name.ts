import envSchema from "env-schema";
import { PrismaClient } from "../generated/prisma/client";
import { envSchema as configEnvSchema } from "../config/env";
import { createPrismaClient } from "../plugins/db";
import { createUserRepository } from "../repositories/user-repository";

/**
 * MOVO-340: corrige nombre y apellido de cuentas registradas antes de que el registro los
 * mandara por separado. Hasta entonces `POST /auth/register` recibía un solo `fullName` y lo
 * cortaba en el primer espacio, así "Juan Cruz" + "Bordino Blanche" quedó guardado como
 * "Juan" + "Cruz Bordino Blanche". No hay de dónde recuperar el corte original (Didit no
 * guarda el nombre en `raw_decision`), así que se corrige a mano por email. Se corre
 * dentro del contenedor, igual que `admin-role.ts`:
 *
 *   docker compose run --rm -T movo-svc-users npm run user:name -- list
 *   docker compose run --rm -T movo-svc-users npm run user:name -- set persona@movo.app "Juan Cruz" "Bordino Blanche"
 *
 * `list` muestra las cuentas con apellido de más de una palabra: las únicas que el corte
 * viejo pudo haber partido mal (no todas lo están: "Pérez García" es un apellido doble real).
 */

const USAGE = 'Uso: npm run user:name -- list | npm run user:name -- set <email> "<nombre>" "<apellido>"';
const NAME_MAX_LENGTH = 80;

export interface FixUserNameCliOutput {
  out(message: string): void;
  err(message: string): void;
}

const consoleOutput: FixUserNameCliOutput = {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
};

function cleanName(value: string | undefined): string | null {
  const cleaned = (value ?? "").trim().replace(/\s+/g, " ");
  return cleaned.length > 0 && cleaned.length <= NAME_MAX_LENGTH ? cleaned : null;
}

/** Corre el comando y devuelve el código de salida; los tests la llaman contra la base real. */
export async function runFixUserNameCli(
  argv: string[],
  db: PrismaClient,
  output: FixUserNameCliOutput = consoleOutput
): Promise<number> {
  const [command, ...args] = argv;

  if (command === "list" && args.length === 0) {
    const rows = await db.$queryRaw<{ email: string; first_name: string; last_name: string }[]>`
      SELECT email, first_name, last_name
      FROM users.users
      WHERE status::text <> 'deleted' AND last_name ~ '\\s'
      ORDER BY created_at`;
    if (rows.length === 0) {
      output.out("No hay cuentas con apellido de más de una palabra.");
      return 0;
    }
    for (const row of rows) output.out(`${row.email}\tnombre: ${row.first_name}\tapellido: ${row.last_name}`);
    return 0;
  }

  if (command === "set" && args.length === 3) {
    const [email, rawFirstName, rawLastName] = args;
    const firstName = cleanName(rawFirstName);
    const lastName = cleanName(rawLastName);
    if (!email?.trim() || !firstName || !lastName) {
      output.err(`Nombre y apellido no pueden quedar vacíos ni pasar los ${NAME_MAX_LENGTH} caracteres.`);
      return 2;
    }
    const repository = createUserRepository(db);
    const user = await repository.findByEmail(email.trim().toLowerCase());
    if (!user) {
      output.err("Error (USER_NOT_FOUND): No existe un usuario con ese email.");
      return 1;
    }
    await repository.updateProfile(user.id, { firstName, lastName });
    output.out(
      `${user.email}: "${user.firstName}" + "${user.lastName}" pasó a "${firstName}" + "${lastName}".`
    );
    return 0;
  }

  output.err(USAGE);
  return 2;
}

async function main(): Promise<void> {
  const config = envSchema<{ DATABASE_URL: string }>({
    schema: {
      type: "object",
      required: ["DATABASE_URL"],
      properties: { DATABASE_URL: configEnvSchema.properties.DATABASE_URL },
    },
    dotenv: true,
  });
  const db = createPrismaClient(config.DATABASE_URL);
  try {
    process.exitCode = await runFixUserNameCli(process.argv.slice(2), db);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
