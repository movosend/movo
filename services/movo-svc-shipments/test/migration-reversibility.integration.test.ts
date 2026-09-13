import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

/**
 * AC1 de MOVO-208 ("la migración es reversible") + su propio DoD ("test de que la
 * migración es reversible"): Postgres no soporta `ALTER TYPE ... DROP VALUE` nativo,
 * así que el camino de reversión real -- documentado como comentario en
 * `prisma/migrations/20260912200000_add_assigned_unfunded_and_completed_states/
 * migration.sql` -- es recrear el tipo sin los 2 valores nuevos.
 *
 * Este test ejecuta ESE camino exacto dentro de una transacción interactiva de Prisma
 * que nunca se commitea (lanza un sentinel al final, forzando el rollback) -- prueba
 * que el SQL de reversión es válido contra Postgres real sin tocar la base compartida
 * de dev. Ningún otro test debería ejecutarse en simultáneo (`fileParallelism: false`
 * en `vitest.config.ts` ya lo garantiza a nivel de archivo).
 */
class RollbackSentinel extends Error {}

const ORIGINAL_9_VALUES = [
  "awaiting_receiver_confirmation",
  "rejected_by_receiver",
  "published",
  "assignment_pending",
  "assigned",
  "in_transit",
  "delivered",
  "cancelled",
  "disputed",
];

const CURRENT_11_VALUES = [
  "awaiting_receiver_confirmation",
  "rejected_by_receiver",
  "published",
  "assignment_pending",
  "assigned_unfunded",
  "assigned",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
];

async function readEnumValues(client: { $queryRawUnsafe<T>(query: string): Promise<T> }): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ enumlabel: string }[]>(`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = 'shipments.shipment_status_enum'::regtype
    ORDER BY enumsortorder
  `);
  return rows.map((r) => r.enumlabel);
}

describe("reversibilidad de la migración MOVO-208 (assigned_unfunded/completed)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("hoy el enum real tiene los 11 valores esperados, en el orden esperado", async () => {
    expect(await readEnumValues(app.db)).toEqual(CURRENT_11_VALUES);
  });

  it("el camino de reversión documentado en la migración recrea el enum de 11 a 9 valores, y el rollback deja todo intacto", async () => {
    let valuesDuringRevert: string[] = [];

    await expect(
      app.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          CREATE TYPE "shipments"."shipment_status_enum_old" AS ENUM (
            'awaiting_receiver_confirmation', 'rejected_by_receiver', 'published',
            'assignment_pending', 'assigned', 'in_transit', 'delivered', 'cancelled',
            'disputed'
          )
        `);
        // El DEFAULT de `shipments.status` (`awaiting_receiver_confirmation`) no se
        // puede castear automáticamente al tipo nuevo -- hallazgo real corriendo este
        // test contra Postgres real, no algo previsto de antemano. Se saca antes del
        // ALTER TYPE y se repone al final, ya apuntando al tipo renombrado.
        await tx.$executeRawUnsafe(`ALTER TABLE "shipments"."shipments" ALTER COLUMN "status" DROP DEFAULT`);
        await tx.$executeRawUnsafe(`
          ALTER TABLE "shipments"."shipments"
            ALTER COLUMN "status" TYPE "shipments"."shipment_status_enum_old"
            USING "status"::text::"shipments"."shipment_status_enum_old"
        `);
        await tx.$executeRawUnsafe(`
          ALTER TABLE "shipments"."shipment_events"
            ALTER COLUMN "from_status" TYPE "shipments"."shipment_status_enum_old"
            USING "from_status"::text::"shipments"."shipment_status_enum_old",
            ALTER COLUMN "to_status" TYPE "shipments"."shipment_status_enum_old"
            USING "to_status"::text::"shipments"."shipment_status_enum_old"
        `);
        await tx.$executeRawUnsafe(`DROP TYPE "shipments"."shipment_status_enum"`);
        await tx.$executeRawUnsafe(
          `ALTER TYPE "shipments"."shipment_status_enum_old" RENAME TO "shipment_status_enum"`,
        );
        await tx.$executeRawUnsafe(`
          ALTER TABLE "shipments"."shipments"
            ALTER COLUMN "status" SET DEFAULT 'awaiting_receiver_confirmation'::"shipments"."shipment_status_enum"
        `);

        valuesDuringRevert = await readEnumValues(tx);

        // Nunca commitear: esto es solo la prueba de que el SQL de reversión es
        // válido, no una reversión real de la base compartida de dev.
        throw new RollbackSentinel("rollback deliberado -- no commitear");
      }),
    ).rejects.toThrow(RollbackSentinel);

    expect(valuesDuringRevert).toEqual(ORIGINAL_9_VALUES);

    // El rollback de Postgres deshace CREATE TYPE/ALTER TABLE/DROP TYPE/RENAME TYPE
    // igual que cualquier otro DDL transaccional -- el enum real queda exactamente
    // como estaba antes de este test.
    expect(await readEnumValues(app.db)).toEqual(CURRENT_11_VALUES);
  });
});
