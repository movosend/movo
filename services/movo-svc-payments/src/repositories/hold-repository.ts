import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { Hold, HoldFailureReason, HoldStatus } from "../generated/prisma/client";
import type { DebtCollection } from "../modules/holds/debt-collection";
import { insertHoldDebtReservation, lockLedgerUser, readCollectableBalance } from "./user-ledger-repository";

export type { Hold };

export interface NewHoldAttempt {
  shipmentId: string;
  attempt: number;
  carrierId: string;
  collectorId: string;
  /**
   * MOVO-311: arma los montos del intento con el saldo de la cuenta corriente del transportista y del
   * emisor, leído con los dos usuarios bloqueados (ver `createAttempt`). Sin deuda devuelve el precio y la
   * comisión de siempre.
   */
  plan: (balances: { carrierBalanceArs: number; payerBalanceArs: number }) => DebtCollection;
  /** Hash del cuerpo del pedido (token, pagador, medio de pago): ver `requestFingerprint`. */
  requestFingerprint: string;
  /** MOVO-282: tarjeta guardada con la que se crea el hold (habilita el `409 CARD_IN_USE` al borrarla). */
  savedCardId?: string | null;
  /**
   * MOVO-302: el emisor que paga (`payerUserId`, MOVO-282). Es lo que permite listar "lo que pagó
   * cada emisor" en el historial; null en los holds anteriores. Opcional para no romper a quien
   * crea intentos sin saber quién paga.
   */
  payerId?: string | null;
  /**
   * MOVO-311: total (`transaction_amount`) que el emisor confirmó. Si con el saldo leído bajo el lock el total del
   * intento es otro, no se crea nada y tira `HoldAmountChangedError`.
   */
  expectedAmountArs?: number | null;
}

export interface HoldUpdate {
  status?: HoldStatus;
  statusDetail?: string | null;
  failureReason?: HoldFailureReason | null;
  mpPaymentId?: string | null;
  expiresAt?: Date | null;
  /**
   * MOVO-302: últimos 4 y marca de la tarjeta, tal como los informa MP en el pago. Solo se
   * escriben cuando MP los trae (`undefined` = no tocar): una respuesta sin `card` nunca borra
   * un dato que una consulta anterior ya había dejado.
   */
  cardLast4?: string;
  cardBrand?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Otro request ganó la carrera por el mismo intento (o por el hold vivo del envío). */
export class HoldAttemptConflictError extends Error {
  constructor() {
    super("Ya existe un intento de hold concurrente para el envío");
    this.name = "HoldAttemptConflictError";
  }
}

/** MOVO-311: el total que corresponde cobrar ya no es el que el emisor confirmó. */
export class HoldAmountChangedError extends Error {
  constructor(public readonly amounts: DebtCollection) {
    super("El total a cobrar cambió desde que el emisor lo confirmó");
    this.name = "HoldAmountChangedError";
  }
}

export interface HoldRepository {
  /** El intento más reciente del envío (mayor `attempt`), cualquiera sea su estado. */
  findLatestByShipment(shipmentId: string): Promise<Hold | null>;
  findById(id: string): Promise<Hold | null>;
  /** MOVO-268: el intento al que MP le asignó ese pago, si existe. */
  findByMpPaymentId(mpPaymentId: string): Promise<Hold | null>;
  /**
   * Inserta un intento en `creating`. Tira `HoldAttemptConflictError` si otro request ya
   * lo creó (`shipment_id`+`attempt`) o si el envío ya tiene un hold vivo (índice parcial).
   *
   * MOVO-311: en la misma transacción reserva la deuda que cobra el intento (`fee_offset` del transportista,
   * `payment_surcharge` del emisor). Los dos usuarios quedan bloqueados (advisory lock, en orden para no
   * trabarse) desde que se lee su saldo hasta el commit, así dos holds en paralelo no descuentan la misma
   * deuda: el segundo ya ve lo que reservó el primero. El saldo que se lee es el cobrable
   * (`readCollectableBalance`): además de las reservas descuenta los pagos de saldo abiertos (MOVO-312).
   */
  createAttempt(data: NewHoldAttempt): Promise<Hold>;
  update(id: string, patch: HoldUpdate): Promise<Hold>;
  /**
   * MOVO-212: `authorized` → `captured` como UPDATE condicional. Devuelve `false` si el hold ya
   * no estaba `authorized` (el webhook de MOVO-268 lo movió en el medio): no se pisa.
   */
  markCaptured(
    id: string,
    patch: { statusDetail: string | null; cardLast4?: string; cardBrand?: string }
  ): Promise<boolean>;
}

export function createHoldRepository(db: PrismaClient): HoldRepository {
  return {
    findLatestByShipment(shipmentId) {
      return db.hold.findFirst({ where: { shipmentId }, orderBy: { attempt: "desc" } });
    },

    findById(id) {
      return db.hold.findUnique({ where: { id } });
    },

    findByMpPaymentId(mpPaymentId) {
      return db.hold.findFirst({ where: { mpPaymentId }, orderBy: { attempt: "desc" } });
    },

    async createAttempt(data) {
      const payerId = data.payerId ?? null;
      // Si cobrador y pagador fueran la misma persona (shipments no lo permite), su saldo se cobraría dos veces en
      // el mismo hold: se cobra solo como cobrador.
      const payerDebtorId = payerId && payerId !== data.carrierId ? payerId : null;
      try {
        return await db.$transaction(async (tx) => {
          const users = [...new Set([data.carrierId, ...(payerId ? [payerId] : [])])].sort();
          for (const userId of users) await lockLedgerUser(tx, userId);
          const [carrierBalance, payerBalance] = await Promise.all([
            readCollectableBalance(tx, data.carrierId),
            payerDebtorId ? readCollectableBalance(tx, payerDebtorId) : Promise.resolve(new Prisma.Decimal(0)),
          ]);
          const amounts = data.plan({
            carrierBalanceArs: carrierBalance.toNumber(),
            payerBalanceArs: payerBalance.toNumber(),
          });
          // Los builds anteriores no mandan el total visto. Pueden seguir pagando el precio acordado, pero
          // nunca se les agrega deuda sin una confirmación explícita del recargo.
          if (data.expectedAmountArs == null ? amounts.debtSurchargeArs > 0 : data.expectedAmountArs !== amounts.amountArs) {
            throw new HoldAmountChangedError(amounts);
          }
          const hold = await tx.hold.create({
            data: {
              shipmentId: data.shipmentId,
              attempt: data.attempt,
              carrierId: data.carrierId,
              collectorId: data.collectorId,
              amountArs: new Prisma.Decimal(amounts.amountArs),
              applicationFeeArs: new Prisma.Decimal(amounts.applicationFeeArs),
              baseAmountArs: new Prisma.Decimal(amounts.baseAmountArs),
              commissionArs: new Prisma.Decimal(amounts.commissionArs),
              debtOffsetArs: new Prisma.Decimal(amounts.debtOffsetArs),
              debtSurchargeArs: new Prisma.Decimal(amounts.debtSurchargeArs),
              requestFingerprint: data.requestFingerprint,
              savedCardId: data.savedCardId ?? null,
              payerId,
              status: "creating",
            },
          });
          if (hold.debtOffsetArs.greaterThan(0)) {
            await insertHoldDebtReservation(tx, {
              userId: data.carrierId,
              type: "fee_offset",
              amountArs: hold.debtOffsetArs,
              shipmentId: hold.shipmentId,
              holdId: hold.id,
            });
          }
          if (payerDebtorId && hold.debtSurchargeArs.greaterThan(0)) {
            await insertHoldDebtReservation(tx, {
              userId: payerDebtorId,
              type: "payment_surcharge",
              amountArs: hold.debtSurchargeArs,
              shipmentId: hold.shipmentId,
              holdId: hold.id,
            });
          }
          return hold;
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new HoldAttemptConflictError();
        throw error;
      }
    },

    update(id, patch) {
      return db.hold.update({ where: { id }, data: patch });
    },

    async markCaptured(id, patch) {
      const { count } = await db.hold.updateMany({
        where: { id, status: "authorized" },
        data: {
          status: "captured",
          statusDetail: patch.statusDetail,
          expiresAt: null,
          // MOVO-302: la captura es la última lectura del pago; completa la tarjeta si faltaba.
          ...(patch.cardLast4 ? { cardLast4: patch.cardLast4 } : {}),
          ...(patch.cardBrand ? { cardBrand: patch.cardBrand } : {}),
        },
      });
      return count === 1;
    },
  };
}
