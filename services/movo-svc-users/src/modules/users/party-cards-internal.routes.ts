import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { AccountStatus, ApiError, KycStatus } from "@movo/shared";
import { createShipmentsClient, ShipmentsClient } from "../../adapters/shipments-client";
import { effectiveAccountStatus, fullName } from "../../models/user";

export interface PartyCardsInternalRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests, mismo criterio que en `usersRoutes`. */
  shipmentsClient?: ShipmentsClient;
}

/** Un envío tiene como máximo tres partes. */
const MAX_PARTY_CARDS = 5;

// Autocontenido a propósito, mismo criterio que `kyc-internal.routes.ts`.
const partyCardsSchemas = {
  querystring: {
    type: "object",
    required: ["ids"],
    properties: { ids: { type: "string", minLength: 36, maxLength: MAX_PARTY_CARDS * 37 } },
  },
  response: {
    type: "array",
    items: {
      type: "object",
      required: [
        "id",
        "fullName",
        "photoUrl",
        "accountStatus",
        "identityVerified",
        "licenseVerified",
        "reputationScore",
        "ratingCount",
      ],
      properties: {
        id: { type: "string" },
        fullName: { type: "string" },
        photoUrl: { type: ["string", "null"] },
        accountStatus: { type: "string", enum: ["active", "suspended", "banned", "deleted"] },
        identityVerified: { type: "boolean" },
        licenseVerified: { type: "boolean" },
        reputationScore: { type: ["number", "null"] },
        ratingCount: { type: "integer" },
      },
    },
  },
};

/**
 * MOVO-325: verificación y reputación de las partes de un envío para el detalle del panel
 * (`svc-admin`). Interno, no se declara en `gateway/src/config/routes-map.ts`. Una cuenta dada de
 * baja también se devuelve (el admin necesita ver con quién se operó); un id inexistente queda
 * afuera de la lista. La reputación es best-effort: si `svc-shipments` no responde, viaja `null`.
 */
export default async function partyCardsInternalRoutes(app: FastifyInstance, opts: PartyCardsInternalRoutesOptions) {
  const shipmentsClient = opts.shipmentsClient ?? createShipmentsClient(app.config);

  app.get(
    "/users/party-cards",
    { schema: { hide: true, querystring: partyCardsSchemas.querystring, response: { 200: partyCardsSchemas.response } } },
    async (request: FastifyRequest) => {
      const { ids } = request.query as { ids: string };
      const userIds = [...new Set(ids.split(",").map((id) => id.trim()).filter(Boolean))];
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (userIds.length === 0 || userIds.length > MAX_PARTY_CARDS || userIds.some((id) => !uuid.test(id))) {
        throw new ApiError(400, "VALIDATION_FAILED", "ids debe ser una lista de 1 a 5 ids de usuario.");
      }

      const users = await app.db.user.findMany({ where: { id: { in: userIds } } });
      return Promise.all(
        users.map(async (user) => {
          let reputation: { reputationScore: number | null; ratingCount: number } = { reputationScore: null, ratingCount: 0 };
          try {
            const summary = await shipmentsClient.findReputation(user.id);
            reputation = { reputationScore: summary.reputationScore, ratingCount: summary.ratingCount };
          } catch (error) {
            app.log.warn(
              { userId: user.id, event: "party_card_reputation_failed", error: (error as Error).message },
              "No se pudo obtener la reputación de svc-shipments para la ficha de la parte",
            );
          }
          return {
            id: user.id,
            fullName: fullName(user),
            photoUrl: user.photoUrl,
            // MOVO-296 AC7: una suspensión vencida que el barrido no cerró cuenta como activa.
            accountStatus: effectiveAccountStatus(user.status as AccountStatus, user.bannedUntil).status as `${AccountStatus}`,
            identityVerified: user.kycStatusIdentity === KycStatus.APPROVED,
            licenseVerified: user.kycStatusLicense === KycStatus.APPROVED,
            ...reputation,
          };
        }),
      );
    },
  );
}
