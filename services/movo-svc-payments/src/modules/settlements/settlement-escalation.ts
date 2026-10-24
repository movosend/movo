import type { FastifyBaseLogger } from "fastify";
import type { AlertNotifier } from "../../adapters/alert-notifier";
import type { ShipmentsClient } from "../../adapters/shipments-client";
import type { Hold } from "../../repositories/hold-repository";
import type { Settlement } from "../../repositories/settlement-repository";

export interface SettlementEscalationDeps {
  /** Se resuelve al escalar: el notifier se decora en un plugin que se registra después de las capturas. */
  alerts: () => AlertNotifier;
  shipments: ShipmentsClient;
  log: FastifyBaseLogger;
}

/**
 * MOVO-213 (AC5/AC7): qué pasa cuando una liquidación pasa a `escalated`. Dos avisos independientes, cada uno
 * best-effort (el otro se manda igual y la liquidación ya quedó escalada y consultable):
 * 1. alerta al equipo — una liquidación escalada que nadie ve es una liquidación perdida;
 * 2. aviso al transportista, vía `svc-shipments` (dueño de los pushes): su cobro está demorado y en revisión.
 */
export function createSettlementEscalationNotifier(deps: SettlementEscalationDeps) {
  return async function onEscalated(settlement: Settlement, hold: Hold): Promise<void> {
    try {
      await deps.alerts().send({
        kind: "settlement_escalated",
        message: "Liquidación escalada a proceso manual: el transportista entregó y no se pudo capturar el cobro",
        context: {
          shipmentId: settlement.shipmentId,
          settlementId: settlement.id,
          holdId: settlement.holdId,
          mpPaymentId: settlement.mpPaymentId,
          carrierId: settlement.carrierId,
          grossAmountArs: settlement.grossAmountArs.toString(),
          failureReason: settlement.failureReason,
          escalationReason: settlement.escalationReason,
          attempts: settlement.attempts,
          lastError: settlement.lastError,
          holdExpiresAt: hold.expiresAt?.toISOString() ?? null,
        },
      });
    } catch (err) {
      deps.log.error({ err, shipmentId: settlement.shipmentId }, "no se pudo mandar la alerta de liquidación escalada");
    }
    try {
      await deps.shipments.notifySettlementEvent(settlement.shipmentId, "delayed");
    } catch (err) {
      deps.log.error({ err, shipmentId: settlement.shipmentId }, "no se pudo avisar al transportista que su cobro está demorado");
    }
  };
}
