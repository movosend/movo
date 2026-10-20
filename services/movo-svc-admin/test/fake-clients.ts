import { AdminCandidate, AdminSummary, ApiError, ChatReportParties, ShipmentParties, UserReportParties } from "@movo/shared";
import { InternalClient } from "../src/adapters/internal-client";
import { ShipmentsClient } from "../src/adapters/shipments-client";
import { UsersClient } from "../src/adapters/users-client";

const unusedRequest: InternalClient["request"] = async () => {
  throw new Error("request genérico fuera de alcance de este fake");
};

/** Servicio dueño caído: cada llamada falla con el 502 que daría el cliente real. */
export const shipmentsDown = () => new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "El servicio de envíos no responde.");
export const usersDown = () => new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "El servicio de usuarios no responde.");

export function createFakeShipmentsClient(data: {
  shipments?: Record<string, ShipmentParties>;
  chatReports?: Record<string, ChatReportParties>;
  down?: boolean;
} = {}): ShipmentsClient {
  return {
    request: unusedRequest,
    async getShipmentParties(id) {
      if (data.down) throw shipmentsDown();
      return data.shipments?.[id] ?? null;
    },
    async getChatReportParties(id) {
      if (data.down) throw shipmentsDown();
      return data.chatReports?.[id] ?? null;
    },
  };
}

export function createFakeUsersClient(
  data: { userReports?: Record<string, UserReportParties>; admins?: AdminSummary[]; candidates?: AdminCandidate[]; down?: boolean } = {},
): UsersClient {
  const admins = data.admins ?? [];
  return {
    request: unusedRequest,
    async listAdmins() {
      if (data.down) throw usersDown();
      return [...admins];
    },
    async searchAdminCandidates(query) {
      if (data.down) throw usersDown();
      const term = query.toLowerCase();
      return (data.candidates ?? []).filter((c) => c.fullName.toLowerCase().includes(term) || c.email.toLowerCase().includes(term));
    },
    async grantAdmin(email) {
      if (data.down) throw usersDown();
      const existing = admins.find((a) => a.email === email);
      if (existing) return existing;
      throw new ApiError(404, "USER_NOT_FOUND", "No existe un usuario con ese email.");
    },
    async revokeAdmin(userId) {
      if (data.down) throw usersDown();
      const index = admins.findIndex((a) => a.id === userId);
      if (index === -1) throw new ApiError(404, "ADMIN_NOT_FOUND", "El usuario no es admin.");
      if (admins.length === 1) throw new ApiError(409, "ADMIN_LAST_ADMIN", "No se puede revocar el rol al último admin.");
      admins.splice(index, 1);
    },
    async getUserReportParties(id) {
      if (data.down) throw usersDown();
      return data.userReports?.[id] ?? null;
    },
  };
}
