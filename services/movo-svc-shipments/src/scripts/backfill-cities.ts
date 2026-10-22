import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { createUsersClient, UsersClient } from "../adapters/users-client";

/**
 * MOVO-325 (B1): completa `pickup_city` / `delivery_city` de los envíos creados antes de que la
 * ciudad se guardara al crear, con el mismo reverse geocoding (`svc-users`). Se corre dentro del
 * contenedor, igual que las migraciones (Postgres no expone puerto público, ADR-010):
 *
 *   docker compose run --rm -T movo-svc-shipments npm run backfill:cities
 *
 * Es idempotente y retomable: solo toca las columnas que siguen en NULL y recorre por id, así un
 * punto que el proveedor no sabe ubicar se intenta una vez por corrida y no se repite en loop.
 * Vive en `src/` y no en una carpeta `scripts/` aparte porque la imagen de producción solo trae
 * `dist/` y no tiene `tsx`.
 */

const BATCH_SIZE = 50;

export interface BackfillCitiesResult {
  scanned: number;
  updated: number;
  /** Puntos que el proveedor no pudo ubicar (quedan en NULL). */
  unresolved: number;
}

export interface BackfillCitiesLogger {
  info(message: string): void;
}

/** Recorre los envíos con alguna ciudad en NULL y la resuelve. `callerUserId` es el emisor de cada envío (ruta protegida). */
export async function backfillShipmentCities(
  db: PrismaClient,
  usersClient: Pick<UsersClient, "findCity">,
  logger: BackfillCitiesLogger = { info: (message) => console.log(message) },
): Promise<BackfillCitiesResult> {
  const result: BackfillCitiesResult = { scanned: 0, updated: 0, unresolved: 0 };
  let afterId: string | undefined;

  for (;;) {
    const batch = await db.shipment.findMany({
      where: { OR: [{ pickupCity: null }, { deliveryCity: null }], ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        senderId: true,
        pickupCity: true,
        pickupLat: true,
        pickupLng: true,
        deliveryCity: true,
        deliveryLat: true,
        deliveryLng: true,
      },
    });
    if (batch.length === 0) break;

    for (const shipment of batch) {
      result.scanned += 1;
      const [pickupCity, deliveryCity] = await Promise.all([
        shipment.pickupCity ??
          usersClient.findCity(shipment.pickupLat.toNumber(), shipment.pickupLng.toNumber(), shipment.senderId),
        shipment.deliveryCity ??
          usersClient.findCity(shipment.deliveryLat.toNumber(), shipment.deliveryLng.toNumber(), shipment.senderId),
      ]);

      const data = {
        ...(shipment.pickupCity === null && pickupCity ? { pickupCity } : {}),
        ...(shipment.deliveryCity === null && deliveryCity ? { deliveryCity } : {}),
      };
      if (Object.keys(data).length > 0) {
        await db.shipment.update({ where: { id: shipment.id }, data });
        result.updated += 1;
      }
      if ((shipment.pickupCity ?? pickupCity) === null || (shipment.deliveryCity ?? deliveryCity) === null) {
        result.unresolved += 1;
      }
    }

    afterId = batch[batch.length - 1]?.id;
    logger.info(`Ciudades: ${result.scanned} envíos revisados, ${result.updated} actualizados.`);
  }

  return result;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const usersUrl = process.env.USERS_SERVICE_URL ?? "http://movo-svc-users:3000";
  if (!databaseUrl) {
    console.error("Falta DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }) });
  try {
    const result = await backfillShipmentCities(db, createUsersClient({ USERS_SERVICE_URL: usersUrl }));
    console.log(
      `Listo: ${result.scanned} envíos revisados, ${result.updated} actualizados, ${result.unresolved} con alguna ciudad sin resolver.`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
