import { FastifyBaseLogger } from "fastify";
import { ApiError, AuditLogPage } from "@movo/shared";
import { AuditLogCursor, AuditLogFilters, AuditRepository } from "./audit.repository";
import { AdminTarget, ConflictChecker } from "./conflict-of-interest";

export interface AdminActionInput {
  adminId: string;
  /** Libre, una por acción de negocio (ej. `user.suspend`, `admin_role.revoke`). */
  action: string;
  target: AdminTarget;
  /** Motivo que escribe el admin; cada acción decide si es obligatorio. */
  reason?: string | null;
  /** Datos de contexto que ayudan a reconstruir la decisión (estado previo, etc.). */
  context?: Record<string, unknown> | null;
  requestId: string;
}

export interface AuditService {
  /**
   * Toda acción de escritura del panel pasa por acá (decisiones 4 y 5 de MOVO-286):
   * 1. regla de conflicto de interés (falla cerrado si el servicio dueño no responde);
   * 2. la acción, que llama al servicio dueño;
   * 3. una sola fila en la bitácora con el resultado.
   * Nunca queda registrada como `succeeded` una acción que no ocurrió (AC5): si la regla o
   * la acción fallan, la fila es `failed` con el código del error y el error se relanza.
   * Excepción: si el servicio dueño no responde (`*_SERVICE_UNAVAILABLE`) la acción pudo haberse
   * aplicada igual, y la fila es `unknown` en vez de `failed`.
   */
  runAdminAction<T>(input: AdminActionInput, action: () => Promise<T>): Promise<T>;
  list(filters: AuditLogFilters, limit: number, cursor?: string): Promise<AuditLogPage>;
}

export interface AuditServiceDeps {
  repository: AuditRepository;
  conflictChecker: ConflictChecker;
  logger: FastifyBaseLogger;
}

export function encodeCursor(cursor: AuditLogCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString("base64url");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(raw: string): AuditLogCursor {
  const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (Number.isNaN(createdAt.getTime()) || !id || !UUID_PATTERN.test(id)) {
    throw new ApiError(400, "VALIDATION_FAILED", "Cursor inválido.");
  }
  return { createdAt, id };
}

function errorCodeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : "INTERNAL_ERROR";
}

/**
 * El servicio dueño no respondió (red, timeout, 5xx): pudo haber aplicado la acción antes de
 * cortarse, así que no se puede afirmar `failed`. Solo vale para errores de la acción; los de la
 * regla de conflicto son lecturas y nunca aplican nada.
 */
function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof ApiError && error.code.endsWith("_SERVICE_UNAVAILABLE");
}

export function createAuditService(deps: AuditServiceDeps): AuditService {
  const { repository, conflictChecker, logger } = deps;

  return {
    async runAdminAction(input, action) {
      const base = {
        adminId: input.adminId,
        action: input.action,
        targetType: input.target.type,
        targetId: input.target.id,
        reason: input.reason ?? null,
        context: input.context ?? null,
        requestId: input.requestId,
      };

      const recordFailure = async (error: unknown, outcome: "failed" | "unknown") => {
        try {
          await repository.insert({ ...base, outcome, errorCode: errorCodeOf(error) });
        } catch (auditError) {
          logger.error({ err: auditError, event: "admin_audit_insert_failed", ...base, outcome }, "No se pudo registrar una acción fallida en la bitácora");
        }
      };

      // El rechazo por conflicto también queda: es el rastro de un intento. Es una lectura, así
      // que cualquier error acá es `failed` (la acción nunca se llamó).
      try {
        await conflictChecker.assertNoConflict(input.adminId, input.target, { requestId: input.requestId });
      } catch (error) {
        await recordFailure(error, "failed");
        throw error;
      }

      let result: Awaited<ReturnType<typeof action>>;
      try {
        result = await action();
      } catch (error) {
        await recordFailure(error, isOutcomeUnknown(error) ? "unknown" : "failed");
        throw error;
      }

      // La acción ya ocurrió en el servicio dueño: si la bitácora falla no se puede deshacer
      // (no hay transacción entre servicios, ADR-001), así que se responde el resultado y se
      // deja el error en el log con todo el contexto para cargarlo a mano (con `created_at` truncado a ms, ver CLAUDE.md de svc-admin). Brecha aceptada:
      // la inversa (registrar como hecha una acción que no ocurrió) nunca pasa.
      try {
        await repository.insert({ ...base, outcome: "succeeded" });
      } catch (auditError) {
        logger.error({ err: auditError, event: "admin_audit_insert_failed", ...base, outcome: "succeeded" }, "Acción del panel hecha pero sin registrar en la bitácora");
      }
      return result;
    },

    async list(filters, limit, cursor) {
      // Uno de más para saber si hay otra página sin un COUNT.
      const rows = await repository.list(filters, limit + 1, cursor ? decodeCursor(cursor) : undefined);
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: new Date(last.createdAt), id: last.id }) : null,
      };
    },
  };
}
