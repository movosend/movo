import type {
  AdminShipmentRole,
  AdminUserRatingRowPage,
  AdminUserShipmentRow,
  AdminUserShipmentRowPage,
  AdminUserTripPage,
} from "@movo/shared";
import { shortShipmentId } from "./short-id";
import { Prisma, PrismaClient, Shipment as ShipmentRow, ShipmentStatus, TripStatus } from "../../generated/prisma/client";

export interface PageQuery {
  page: number;
  pageSize: number;
}

const ROLE_COLUMN: Record<AdminShipmentRole, "senderId" | "carrierId" | "receiverId"> = {
  sender: "senderId",
  carrier: "carrierId",
  receiver: "receiverId",
};

/** Una persona puede ocupar dos roles en el mismo envío (p. ej. emisor y receptor): gana el primero. */
function roleOf(row: ShipmentRow, userId: string): AdminShipmentRole {
  if (row.senderId === userId) return "sender";
  if (row.carrierId === userId) return "carrier";
  return "receiver";
}

function toShipmentRow(row: ShipmentRow, userId: string): AdminUserShipmentRow {
  const price = row.agreedPriceArs ?? row.suggestedPriceArs;
  return {
    id: row.id,
    // No hay otro código de envío: el panel muestra los 8 primeros caracteres del UUID.
    shortId: shortShipmentId(row.id),
    status: row.status,
    pickupAddress: row.pickupAddress,
    deliveryAddress: row.deliveryAddress,
    priceArs: price === null ? null : price.toNumber(),
    createdAt: row.createdAt.toISOString(),
    userRole: roleOf(row, userId),
    senderId: row.senderId,
    carrierId: row.carrierId,
    receiverId: row.receiverId,
  };
}

const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/**
 * MOVO-294: secciones de la ficha del panel que son de `svc-shipments`. Devuelven ids de usuario;
 * `svc-admin` los cambia por nombres. Un usuario que no existe simplemente no tiene filas: este
 * servicio no sabe qué cuentas existen, y consultar a `svc-users` haría que la sección dependa de
 * otro servicio (cada sección falla sola, AC3 de MOVO-293).
 */
export function createAdminUsersService(db: PrismaClient) {
  return {
    /** `counts` cuenta por rol con el filtro de estado aplicado, para las pestañas del panel. */
    async listShipments(
      userId: string,
      filters: { role?: AdminShipmentRole; status?: ShipmentStatus },
      { page, pageSize }: PageQuery,
    ): Promise<AdminUserShipmentRowPage> {
      const status = filters.status ? { status: filters.status } : {};
      const involved: Prisma.ShipmentWhereInput = filters.role
        ? { [ROLE_COLUMN[filters.role]]: userId }
        : { OR: [{ senderId: userId }, { carrierId: userId }, { receiverId: userId }] };
      const where: Prisma.ShipmentWhereInput = { ...involved, ...status };

      const [rows, total, sender, carrier, receiver] = await Promise.all([
        db.shipment.findMany({ where, orderBy: NEWEST_FIRST, skip: (page - 1) * pageSize, take: pageSize }),
        db.shipment.count({ where }),
        db.shipment.count({ where: { senderId: userId, ...status } }),
        db.shipment.count({ where: { carrierId: userId, ...status } }),
        db.shipment.count({ where: { receiverId: userId, ...status } }),
      ]);
      return {
        items: rows.map((row) => toShipmentRow(row, userId)),
        page,
        pageSize,
        total,
        counts: { sender, carrier, receiver },
      };
    },

    async listTrips(userId: string, filters: { status?: TripStatus }, { page, pageSize }: PageQuery): Promise<AdminUserTripPage> {
      const where: Prisma.TripWhereInput = { carrierId: userId, ...(filters.status ? { status: filters.status } : {}) };
      const [rows, total] = await Promise.all([
        db.trip.findMany({
          where,
          orderBy: [{ departureAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.trip.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          originAddress: row.originAddress,
          destinationAddress: row.destinationAddress,
          departureAt: row.departureAt.toISOString(),
          vehicleType: row.vehicleType,
          status: row.status,
          recurring: row.recurrenceWeekdays.length > 0,
        })),
        page,
        pageSize,
        total,
      };
    },

    /** Calificaciones recibidas. `average` es el promedio simple de todas, no el score de reputación. */
    async listRatings(userId: string, { page, pageSize }: PageQuery): Promise<AdminUserRatingRowPage> {
      const [rows, aggregate] = await Promise.all([
        db.rating.findMany({ where: { rateeId: userId }, orderBy: NEWEST_FIRST, skip: (page - 1) * pageSize, take: pageSize }),
        db.rating.aggregate({ where: { rateeId: userId }, _avg: { score: true }, _count: { _all: true } }),
      ]);
      const average = aggregate._avg.score;
      return {
        average: average === null ? null : Math.round(average * 100) / 100,
        count: aggregate._count._all,
        items: rows.map((row) => ({
          score: row.score,
          comment: row.comment,
          raterId: row.raterId,
          roleOfRated: row.role,
          shipmentId: row.shipmentId,
          createdAt: row.createdAt.toISOString(),
        })),
        page,
        pageSize,
      };
    },
  };
}
