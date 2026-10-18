import { ApiError, ChatReportParties, ShipmentParties, UserReportParties } from "@movo/shared";
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

export function createFakeUsersClient(data: { userReports?: Record<string, UserReportParties>; down?: boolean } = {}): UsersClient {
  return {
    request: unusedRequest,
    async getUserReportParties(id) {
      if (data.down) throw usersDown();
      return data.userReports?.[id] ?? null;
    },
  };
}
