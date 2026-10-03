import { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  PricingGameSessionRecord,
  PricingGameSessionForStats,
} from "../models/pricing-game";

/**
 * Juego de precios de la feria: persistencia de partidas (`shipments.pricing_game_sessions`).
 * Upsert por `id` (UUID del cliente) para que el reenvío de la cola offline del iPad no
 * duplique filas. Un reenvío que ya no puede verificar la cotización (venció en Redis)
 * no pisa la de una fila que sí quedó verificada: solo actualiza las respuestas.
 */
export interface PricingGameRepository {
  upsertSession(record: PricingGameSessionRecord): Promise<{ created: boolean }>;
  listForStats(eventTag: string | undefined, limit: number): Promise<PricingGameSessionForStats[]>;
}

const dec = (value: number | null | undefined) => (value == null ? null : new Prisma.Decimal(value));
const num = (value: Prisma.Decimal | null) => (value == null ? null : value.toNumber());

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Columnas que salen de la cotización (o de lo cotizado): fijas una vez verificadas. */
const QUOTE_COLUMNS = [
  "originName",
  "originProvince",
  "originLat",
  "originLng",
  "destinationName",
  "destinationProvince",
  "destinationLat",
  "destinationLng",
  "packagePreset",
  "packageType",
  "weightKg",
  "quoteId",
  "quoteVerified",
  "calculationMethod",
  "suggestedPriceArs",
  "highDemand",
  "distanceKm",
  "distanceSource",
  "fuelArsPerLiter",
  "breakdown",
  "commissionRate",
  "courierEarnArs",
] as const;

function toRow(r: PricingGameSessionRecord) {
  return {
    eventTag: r.eventTag,
    deviceId: r.deviceId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationSec: r.durationSec,
    completed: r.completed,
    lastScreen: r.lastScreen,
    originName: r.originName,
    originProvince: r.originProvince,
    originLat: dec(r.originLat),
    originLng: dec(r.originLng),
    destinationName: r.destinationName,
    destinationProvince: r.destinationProvince,
    destinationLat: dec(r.destinationLat),
    destinationLng: dec(r.destinationLng),
    packagePreset: r.packagePreset,
    packageType: r.packageType,
    weightKg: dec(r.weightKg),
    quoteId: r.quoteId,
    quoteVerified: r.quoteVerified,
    calculationMethod: r.calculationMethod,
    suggestedPriceArs: dec(r.suggestedPriceArs),
    highDemand: r.highDemand,
    distanceKm: dec(r.distanceKm),
    distanceSource: r.distanceSource,
    fuelArsPerLiter: dec(r.fuelArsPerLiter),
    breakdown: r.breakdown == null ? Prisma.DbNull : (r.breakdown as unknown as Prisma.InputJsonValue),
    senderAnswer: r.senderAnswer,
    senderAltChoice: r.senderAltChoice,
    senderWtpArs: dec(r.senderWtpArs),
    commissionRate: dec(r.commissionRate),
    courierEarnArs: dec(r.courierEarnArs),
    courierAnswer: r.courierAnswer,
    courierAltChoice: r.courierAltChoice,
    courierWtaArs: dec(r.courierWtaArs),
    uberEstimateArs: dec(r.uberEstimateArs),
    email: r.email,
    userAgent: r.userAgent,
  };
}

export function createPricingGameRepository(db: PrismaClient): PricingGameRepository {
  const repository: PricingGameRepository = {
    async upsertSession(record) {
      const data = toRow(record);
      const existing = await db.pricingGameSession.findUnique({
        where: { id: record.id },
        select: { quoteVerified: true },
      });
      if (!existing) {
        try {
          await db.pricingGameSession.create({ data: { id: record.id, ...data } });
          return { created: true };
        } catch (error) {
          // Dos PUT simultáneos de la misma partida: el que pierde sigue como reenvío.
          if (!isUniqueViolation(error)) throw error;
          return repository.upsertSession(record);
        }
      }

      const update: Partial<typeof data> = { ...data };
      if (existing.quoteVerified && !record.quoteVerified) {
        for (const column of QUOTE_COLUMNS) delete update[column];
      }
      await db.pricingGameSession.update({ where: { id: record.id }, data: update });
      return { created: false };
    },

    async listForStats(eventTag, limit) {
      const rows = await db.pricingGameSession.findMany({
        where: eventTag ? { eventTag } : {},
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          quoteVerified: true,
          completed: true,
          packagePreset: true,
          distanceKm: true,
          suggestedPriceArs: true,
          senderAnswer: true,
          senderWtpArs: true,
          courierEarnArs: true,
          courierAnswer: true,
          courierWtaArs: true,
        },
      });
      return rows.map((row) => ({
        completed: row.completed,
        packagePreset: row.packagePreset,
        distanceKm: num(row.distanceKm),
        // Un precio sin verificar llegó en el body: no entra a los ratios WTP/WTA (mismo
        // criterio que las queries de `docs/pricing/pricing-game-metrics.md`).
        suggestedPriceArs: row.quoteVerified ? num(row.suggestedPriceArs) : null,
        senderAnswer: row.senderAnswer,
        senderWtpArs: num(row.senderWtpArs),
        courierEarnArs: row.quoteVerified ? num(row.courierEarnArs) : null,
        courierAnswer: row.courierAnswer,
        courierWtaArs: num(row.courierWtaArs),
      }));
    },
  };
  return repository;
}
