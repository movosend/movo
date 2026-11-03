import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import {
  ADMIN_OVERVIEW_BLOCKS,
  AdminOverview,
  AdminOverviewBlock,
  AdminOverviewBlockName,
  AdminOverviewBlocks,
  ApiError,
  toOverviewInbox,
} from "@movo/shared";
import { block } from "../../utils/admin-block";
import { requireAdmin } from "../../utils/require-admin";
import { overviewSchemas } from "./overview.schema";

/** `?blocks=kyc,support`: sin el parámetro, todos. Un nombre desconocido es 400, no una tarjeta que nunca llega. */
function requestedBlocks(raw: string | undefined): readonly AdminOverviewBlockName[] {
  const names = (raw ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return ADMIN_OVERVIEW_BLOCKS;
  const unknown = names.filter((name) => !(ADMIN_OVERVIEW_BLOCKS as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new ApiError(400, "VALIDATION_FAILED", `Bloques desconocidos: ${unknown.join(", ")}.`);
  }
  return [...new Set(names)] as AdminOverviewBlockName[];
}

/**
 * MOVO-342: home del panel, una bandeja por bloque (DD-058). Cada una la cuenta su servicio dueño (ADR-025) y se piden en
 * paralelo: si una no responde, o se pasa del timeout de 5 s del cliente interno, esa tarjeta viene con su error y su
 * `requestId`, y el resto sigue. Lectura pura: sin bitácora ni regla de conflicto.
 */
export default async function overviewRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get(
    "/overview",
    {
      schema: {
        tags: ["admin"],
        summary: "Bandejas de la home del panel",
        description:
          "MOVO-342: disputas, soporte, KYC, reportes de usuarios, envíos en alerta, pagos, mensajes señalados y sanciones que vencen hoy. " +
          "Con `?blocks=kyc,support` vienen solo esos, para reintentar una tarjeta. Cada bloque es `{ data, error }`: un servicio caído no " +
          "tumba la home.",
        querystring: overviewSchemas.query,
        response: {
          200: overviewSchemas.response,
          400: overviewSchemas.errorResponse,
          401: overviewSchemas.errorResponse,
          403: overviewSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<AdminOverview> => {
      requireAdmin(request);
      const names = requestedBlocks((request.query as { blocks?: string }).blocks);
      const ctx = { requestId: request.requestId };

      const loaders: { [K in AdminOverviewBlockName]: () => Promise<NonNullable<Extract<AdminOverviewBlocks[K], { error: null }>["data"]>> } = {
        disputes: async () => toOverviewInbox("disputes", await app.shipmentsClient.getOverviewDisputes(ctx)),
        support: async () => toOverviewInbox("support", await app.shipmentsClient.getOverviewSupport(ctx)),
        shipmentAlerts: async () => toOverviewInbox("shipmentAlerts", await app.shipmentsClient.getOverviewShipmentAlerts(ctx)),
        flaggedMessages: async () => toOverviewInbox("flaggedMessages", await app.shipmentsClient.getOverviewFlaggedMessages(ctx)),
        kyc: async () => toOverviewInbox("kyc", await app.usersClient.getOverviewKyc(ctx)),
        userReports: async () => toOverviewInbox("userReports", await app.usersClient.getOverviewUserReports(ctx)),
        sanctionsEndingToday: async () => toOverviewInbox("sanctionsEndingToday", await app.usersClient.getOverviewSanctionsEndingToday(ctx)),
        payments: async () => toOverviewInbox("payments", await app.paymentsClient.getOverview(ctx)),
      };

      const entries = await Promise.all(
        names.map(async (name): Promise<[AdminOverviewBlockName, AdminOverviewBlock<unknown>]> => {
          const result = await block<unknown>(() => loaders[name]());
          if (result.error === null) return [name, result];
          // La tarjeta muestra el `requestId`: tiene que encontrarse en los logs qué bloque falló y por qué.
          request.log.warn({ event: "admin_overview_block_failed", block: name, code: result.error.code, requestId: ctx.requestId }, "Falló un bloque de la home");
          return [name, { data: null, error: { ...result.error, requestId: ctx.requestId } }];
        }),
      );

      reply.header("cache-control", "no-store");
      return { generatedAt: new Date().toISOString(), blocks: Object.fromEntries(entries) as AdminOverview["blocks"] };
    },
  );
}
