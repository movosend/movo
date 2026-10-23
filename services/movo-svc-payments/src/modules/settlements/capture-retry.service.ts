import type { FastifyBaseLogger } from "fastify";
import { ApiError } from "@movo/shared";
import type { Settlement, SettlementRepository } from "../../repositories/settlement-repository";
import type { CaptureService } from "./capture.service";

export interface CaptureRetryServiceDeps {
  settlements: Pick<SettlementRepository, "findDueForRetry" | "claimRetry">;
  captures: Pick<CaptureService, "capture" | "escalateUnrecoverable">;
  log: FastifyBaseLogger;
  /** Un reintento acreditó la liquidación: svc-shipments tiene que pasar el envío a `completed`. */
  onCredited?: (shipmentId: string) => Promise<void>;
  now?: () => Date;
  /** Cuántas liquidaciones toma una pasada. */
  batchSize?: number;
  /** Cuánto se reserva una liquidación mientras se la reintenta; si el proceso muere, vuelve a tocar pasado ese tiempo. */
  leaseMinutes?: number;
}

export interface CaptureRetryRun {
  attempted: number;
  credited: number;
  failed: number;
}

/**
 * MOVO-213 (AC2): reintenta las entregas `failed` cuyo `next_attempt_at` ya llegó. Cada pasada toma un lote, lo
 * reserva con un lease (UPDATE condicional, así dos réplicas no reintentan la misma) y delega en
 * `captures.capture`, que es quien decide: consulta el pago en MP antes de capturar (AC3), mira `expires_at`
 * (AC8), y tras el último intento o ante un fallo no reintentable escala (AC4/AC5). Acá solo se orquesta.
 */
export function createCaptureRetryService(deps: CaptureRetryServiceDeps) {
  const { settlements, captures, log } = deps;
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize ?? 20;
  const leaseMs = (deps.leaseMinutes ?? 10) * 60_000;

  return {
    async runOnce(): Promise<CaptureRetryRun> {
      const run: CaptureRetryRun = { attempted: 0, credited: 0, failed: 0 };
      const due = await settlements.findDueForRetry(now(), batchSize);
      for (const settlement of due) {
        if (!settlement.nextAttemptAt) continue;
        const claimed = await settlements.claimRetry(settlement.id, settlement.nextAttemptAt, new Date(now().getTime() + leaseMs));
        if (!claimed) continue;
        run.attempted += 1;
        try {
          const { settlement: result } = await captures.capture(settlement.shipmentId, { kind: "delivery" }, { retryJob: true });
          if (result.status === "credited") {
            run.credited += 1;
            await deps.onCredited?.(settlement.shipmentId).catch((err: unknown) =>
              // El cobro ya está acreditado; el barrido de shipments también completa el envío si este aviso se pierde.
              log.error({ err, shipmentId: settlement.shipmentId }, "no se pudo avisar a shipments que el reintento acreditó el cobro")
            );
          }
        } catch (error) {
          run.failed += 1;
          await recordUnrecoverable(settlement, error);
        }
      }
      if (run.attempted > 0) log.info({ ...run }, "barrido de reintentos de captura");
      return run;
    },
  };

  /**
   * `capture()` ya deja registrado todo fallo que ocurre al hablar con MP (reintento programado o escalado). Lo que
   * rechaza ANTES (el hold ya no existe o no es capturable, la liquidación es de otro hold) no toca la fila y
   * reintentar no lo arregla: se escala para que no quede `failed` dando vueltas.
   */
  async function recordUnrecoverable(settlement: Settlement, error: unknown): Promise<void> {
    if (!(error instanceof ApiError)) {
      log.error({ err: error, shipmentId: settlement.shipmentId }, "error inesperado al reintentar la captura");
      return;
    }
    const preMp = ["HOLD_NOT_FOUND", "HOLD_NOT_CAPTURABLE", "HOLD_CONFLICT", "SETTLEMENT_CONFLICT"].includes(error.code);
    if (!preMp) return;
    const escalated = await captures.escalateUnrecoverable(
      settlement.shipmentId,
      error.code === "HOLD_NOT_CAPTURABLE" || error.code === "HOLD_NOT_FOUND" ? "hold_expired" : "provider_error",
      `${error.code}: ${error.message}`
    );
    if (escalated) log.error({ shipmentId: settlement.shipmentId, code: error.code }, "reintento imposible: liquidación escalada");
  }
}

export type CaptureRetryService = ReturnType<typeof createCaptureRetryService>;
