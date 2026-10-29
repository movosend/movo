import { AdminTargetType, ApiError } from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { ShipmentsClient } from "../../adapters/shipments-client";
import { UsersClient } from "../../adapters/users-client";
import { SupportClient } from "../../adapters/support-client";

/** Sobre qué actúa el admin. */
export interface AdminTarget {
  type: AdminTargetType;
  id: string;
}

export interface ConflictChecker {
  /**
   * Regla de conflicto de interés (decisión 5 de MOVO-286): rechaza con 403
   * `ADMIN_CONFLICT_OF_INTEREST` si el admin es parte del objetivo. Solo para acciones de
   * escritura; leer sí puede. Si el servicio dueño no responde, falla cerrado (su 502 se
   * propaga) y un objetivo inexistente es 404: nunca se deja pasar sin poder comprobarlo.
   */
  assertNoConflict(adminId: string, target: AdminTarget, ctx: RequestContext): Promise<void>;
}

export interface ConflictCheckerDeps {
  usersClient: UsersClient;
  shipmentsClient: ShipmentsClient;
  supportClient: SupportClient;
}

export function createConflictChecker(deps: ConflictCheckerDeps): ConflictChecker {
  async function partiesOf(target: AdminTarget, ctx: RequestContext): Promise<string[]> {
    switch (target.type) {
      // Él mismo y su propio rol: alcanza con comparar ids, sin I/O.
      case "user":
      case "admin_role":
        return [target.id];

      case "shipment": {
        const parties = await deps.shipmentsClient.getShipmentParties(target.id, ctx);
        if (!parties) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
        return [parties.senderId, parties.carrierId, parties.receiverId, ...parties.formerReceiverIds].filter(
          (id): id is string => id !== null,
        );
      }

      // MOVO-337: las partes del envío disputado (incluidos los receptores anteriores), como en `shipment`.
      case "dispute": {
        const parties = await deps.shipmentsClient.getDisputeParties(target.id, ctx);
        if (!parties) throw new ApiError(404, "NOT_FOUND", "Disputa no encontrada.");
        return [parties.senderId, parties.carrierId, parties.receiverId, ...parties.formerReceiverIds].filter(
          (id): id is string => id !== null,
        );
      }

      case "chat_report": {
        const parties = await deps.shipmentsClient.getChatReportParties(target.id, ctx);
        if (!parties) throw new ApiError(404, "NOT_FOUND", "Reporte no encontrado.");
        return parties.partyIds;
      }

      case "user_report": {
        const parties = await deps.usersClient.getUserReportParties(target.id, ctx);
        if (!parties) throw new ApiError(404, "NOT_FOUND", "Reporte no encontrado.");
        return [parties.reporterId, parties.reportedId];
      }

      // MOVO-322: el admin es parte de una consulta si es el usuario que la abrió (su propia consulta).
      case "support_conversation": {
        const parties = await deps.supportClient.getParties(target.id, ctx);
        if (!parties) throw new ApiError(404, "SUPPORT_CONVERSATION_NOT_FOUND", "La consulta no existe.");
        return [parties.userId];
      }
    }
  }

  return {
    async assertNoConflict(adminId, target, ctx) {
      const parties = await partiesOf(target, ctx);
      if (parties.includes(adminId)) {
        throw new ApiError(
          403,
          "ADMIN_CONFLICT_OF_INTEREST",
          "No podés actuar sobre algo en lo que sos parte. Pedile a otro administrador que lo haga.",
        );
      }
    },
  };
}
