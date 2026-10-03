import { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  PricingGameSessionRecord,
  PricingGameSessionForStats,
} from "../models/pricing-game";

/**
 * Juego de precios de la feria: persistencia de partidas (`shipments.pricing_game_sessions`).
 * Upsert por `id` (UUID del cliente) para que el reenvío de la cola offline del iPad no
 * duplique filas.
 */
export interface PricingGameRepository {
  upsertSession(record: PricingGameSessionRecord): Promise<{ created: boolean }>;
  listForStats(eventTag: string | undefined, limit: number): Promise<PricingGameSessionForStats[]>;
}

const dec = (value: number | null | undefined) => (value == null ? null : new Prisma.Decimal(value));
const num = (value: Prisma.Decimal | null) => (value == null ? null : value.toNumber());

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
  return {
    async upsertSession(record) {
      const data = toRow(record);
      const existing = await db.pricingGameSession.findUnique({ where: { id: record.id }, select: { id: true } });
      await db.pricingGameSession.upsert({
        where: { id: record.id },
        create: { id: record.id, ...data },
        update: data,
      });
      return { created: !existing };
    },

    async listForStats(eventTag, limit) {
      const rows = await db.pricingGameSession.findMany({
        where: eventTag ? { eventTag } : {},
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
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
        suggestedPriceArs: num(row.suggestedPriceArs),
        senderAnswer: row.senderAnswer,
        senderWtpArs: num(row.senderWtpArs),
        courierEarnArs: num(row.courierEarnArs),
        courierAnswer: row.courierAnswer,
        courierWtaArs: num(row.courierWtaArs),
      }));
    },
  };
}
