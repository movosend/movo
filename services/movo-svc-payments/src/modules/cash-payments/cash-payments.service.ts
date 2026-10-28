import { ApiError, cashPenaltyCompensationArs, decomposeOfferGrossPrice } from "@movo/shared";
import type {
  RegisterCashCancellationPenaltyRequest,
  RegisterCashCancellationPenaltyResponse,
  RegisterCashCommissionRequest,
  RegisterCashCommissionResponse,
  UserLedgerEntry as UserLedgerEntryDto,
} from "@movo/shared";
import { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { UserLedgerEntry } from "../../generated/prisma/client";
import { fingerprintOf } from "../../repositories/user-ledger-repository";
import { LEDGER_MAX_ABS_AMOUNT_ARS } from "../user-ledger/user-ledger.service";

/**
 * MOVO-37: envíos pagados en efectivo. No hay hold: el emisor le paga al transportista en mano al retiro, así que
 * lo que Movo cobra o reparte pasa por la cuenta corriente (DD-044).
 *
 * - `registerCommission` (al confirmarse la entrega): la comisión de Movo como deuda del transportista
 *   (`cash_commission`), con el MISMO cálculo que el `application_fee` de un envío con tarjeta por ese precio
 *   (`decomposeOfferGrossPrice`, el que usa `computeDebtCollection`), y la fila de `cash_shipment_payments` que el
 *   historial muestra como "Pago en efectivo".
 * - `registerCancellationPenalty` (cancelación tardía del emisor, DD-047): la penalidad como deuda del emisor y la
 *   compensación del transportista (`cashPenaltyCompensationArs`, lo mismo que le deja la captura parcial con
 *   tarjeta) como crédito en la suya.
 *
 * Los dos son idempotentes por envío y atómicos: corren en una transacción con un lock por envío, y un reintento
 * devuelve lo ya registrado sin volver a calcular (si la tasa de comisión cambió entremedio, rige la del primer
 * registro). Un reintento con otras partes o con otro monto es un 409: no es el mismo envío que se registró.
 */
export interface CashPaymentsService {
  registerCommission(shipmentId: string, input: RegisterCashCommissionRequest): Promise<RegisterCashCommissionResponse>;
  registerCancellationPenalty(
    shipmentId: string,
    input: RegisterCashCancellationPenaltyRequest
  ): Promise<RegisterCashCancellationPenaltyResponse>;
}

const { Decimal } = Prisma;

const toMoney = (value: number) => new Decimal(value.toFixed(2));

function assertAmount(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > LEDGER_MAX_ABS_AMOUNT_ARS || Math.round(value * 100) / 100 !== value) {
    throw new ApiError(400, "VALIDATION_FAILED", `${name} tiene que ser un monto mayor que cero, con hasta 2 decimales`);
  }
}

function conflict(message: string): ApiError {
  return new ApiError(409, "LEDGER_IDEMPOTENCY_CONFLICT", message);
}

function toDto(row: UserLedgerEntry): UserLedgerEntryDto {
  return {
    id: row.id,
    userId: row.userId,
    roleAtOrigin: row.roleAtOrigin,
    type: row.type,
    amountArs: row.amountArs.toNumber(),
    status: row.status,
    shipmentId: row.shipmentId,
    holdId: row.holdId,
    paymentId: row.paymentId,
    reason: null,
    createdAt: row.createdAt.toISOString(),
  };
}

type EntryData = {
  userId: string;
  roleAtOrigin: "sender" | "carrier";
  type: "cash_commission" | "cancellation_penalty" | "cancellation_compensation";
  amountArs: Prisma.Decimal;
  status: "pending" | "settled";
  shipmentId: string;
  idempotencyKey: string;
};

/** Misma huella que `userLedger.createEntry`: un reintento por el endpoint genérico con la misma key coincide. */
function entryCreate(data: EntryData): Prisma.UserLedgerEntryUncheckedCreateInput {
  return {
    ...data,
    holdId: null,
    paymentId: null,
    reason: null,
    adminId: null,
    createdAt: new Date(),
    requestFingerprint: fingerprintOf({
      userId: data.userId,
      type: data.type,
      roleAtOrigin: data.roleAtOrigin,
      amount: data.amountArs.toFixed(2),
      status: data.status,
      shipmentId: data.shipmentId,
      holdId: null,
      paymentId: null,
    }),
  };
}

/** Serializa los registros del mismo envío: dos reintentos a la vez terminan con un solo registro. */
async function lockShipment(tx: Prisma.TransactionClient, shipmentId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash_shipment:${shipmentId}`}))`;
}

export function createCashPaymentsService(db: PrismaClient): CashPaymentsService {
  return {
    async registerCommission(shipmentId, input) {
      assertAmount("agreedPriceArs", input.agreedPriceArs);
      const commissionArs = decomposeOfferGrossPrice(input.agreedPriceArs).commissionAmountArs;

      return db.$transaction(async (tx) => {
        await lockShipment(tx, shipmentId);
        const existing = await tx.cashShipmentPayment.findUnique({ where: { shipmentId }, include: { ledgerEntry: true } });
        if (existing) {
          if (
            existing.senderId !== input.senderId ||
            existing.carrierId !== input.carrierId ||
            !existing.amountArs.equals(toMoney(input.agreedPriceArs))
          ) {
            throw conflict("La comisión de este envío ya se registró con otros datos.");
          }
          if (!existing.ledgerEntry) {
            // Comisión en cero: no hay movimiento que devolver. No pasa con los precios reales (hay un mínimo).
            throw new ApiError(409, "LEDGER_ENTRY_NOT_FOUND", "El envío no tiene una comisión registrada en la cuenta corriente.");
          }
          return { commissionArs: existing.commissionArs.toNumber(), entry: toDto(existing.ledgerEntry), created: false };
        }

        if (commissionArs <= 0) {
          throw new ApiError(400, "VALIDATION_FAILED", "El precio acordado no genera comisión.");
        }
        const entry = await tx.userLedgerEntry.create({
          data: entryCreate({
            userId: input.carrierId,
            roleAtOrigin: "carrier",
            type: "cash_commission",
            amountArs: toMoney(commissionArs),
            status: "pending",
            shipmentId,
            idempotencyKey: `cash_commission:${shipmentId}`,
          }),
        });
        await tx.cashShipmentPayment.create({
          data: {
            shipmentId,
            senderId: input.senderId,
            carrierId: input.carrierId,
            amountArs: toMoney(input.agreedPriceArs),
            commissionArs: toMoney(commissionArs),
            ledgerEntryId: entry.id,
          },
        });
        return { commissionArs, entry: toDto(entry), created: true };
      });
    },

    async registerCancellationPenalty(shipmentId, input) {
      assertAmount("agreedPriceArs", input.agreedPriceArs);
      assertAmount("penaltyArs", input.penaltyArs);
      if (input.penaltyArs > input.agreedPriceArs) {
        throw new ApiError(400, "VALIDATION_FAILED", "penaltyArs no puede superar el precio acordado");
      }
      // Misma key que la penalidad de un envío con tarjeta (`settlement.service.ts` de svc-shipments): un envío es de
      // una sola modalidad, y así nunca puede quedar la penalidad registrada dos veces.
      const penaltyKey = `penalty:${shipmentId}`;
      const compensationKey = `penalty_compensation:${shipmentId}`;

      return db.$transaction(async (tx) => {
        await lockShipment(tx, shipmentId);
        const existing = await tx.userLedgerEntry.findUnique({ where: { idempotencyKey: penaltyKey } });
        if (existing) {
          if (existing.userId !== input.senderId || !existing.amountArs.equals(toMoney(input.penaltyArs))) {
            throw conflict("La penalidad de este envío ya se registró con otros datos.");
          }
          const compensation = await tx.userLedgerEntry.findUnique({ where: { idempotencyKey: compensationKey } });
          if (compensation && compensation.userId !== input.carrierId) {
            throw conflict("La compensación de este envío ya se registró para otro transportista.");
          }
          return {
            penaltyEntry: toDto(existing),
            compensationEntry: compensation ? toDto(compensation) : null,
            compensationArs: compensation ? compensation.amountArs.negated().toNumber() : 0,
            created: false,
          };
        }

        const penaltyEntry = await tx.userLedgerEntry.create({
          data: entryCreate({
            userId: input.senderId,
            roleAtOrigin: "sender",
            type: "cancellation_penalty",
            amountArs: toMoney(input.penaltyArs),
            status: "pending",
            shipmentId,
            idempotencyKey: penaltyKey,
          }),
        });
        const compensationArs = cashPenaltyCompensationArs(input.agreedPriceArs, input.penaltyArs);
        const compensationEntry =
          compensationArs > 0
            ? await tx.userLedgerEntry.create({
                data: entryCreate({
                  userId: input.carrierId,
                  roleAtOrigin: "carrier",
                  type: "cancellation_compensation",
                  // Crédito: negativo y saldado (no es una deuda que se cobre).
                  amountArs: toMoney(-compensationArs),
                  status: "settled",
                  shipmentId,
                  idempotencyKey: compensationKey,
                }),
              })
            : null;
        return {
          penaltyEntry: toDto(penaltyEntry),
          compensationEntry: compensationEntry ? toDto(compensationEntry) : null,
          compensationArs,
          created: true,
        };
      });
    },
  };
}
