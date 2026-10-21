import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { createUserRepository } from "../../repositories/user-repository";

/** Tope por request: `svc-shipments` pide de a un lote de envíos, con hasta tres partes cada uno. */
const MAX_IDS_PER_REQUEST = 500;

// Autocontenido a propósito, mismo criterio que el resto de los módulos.
const deletionStatusSchemas = {
  body: {
    type: "object",
    required: ["ids"],
    additionalProperties: false,
    properties: {
      ids: {
        type: "array",
        maxItems: MAX_IDS_PER_REQUEST,
        items: { type: "string", format: "uuid" },
      },
    },
  },
  response: {
    type: "object",
    required: ["users"],
    properties: {
      users: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "deletedAt"],
          properties: {
            id: { type: "string" },
            deletedAt: { type: ["string", "null"], format: "date-time" },
          },
        },
      },
    },
  },
};

interface DeletionStatusResponse {
  users: { id: string; deletedAt: string | null }[];
}

/**
 * MOVO-230: `svc-shipments` no sabe qué cuentas se dieron de baja ni cuándo, y lo necesita
 * para purgar el historial de envíos vencido (Política de Privacidad §7). Devuelve una fila
 * por id pedido, con `deletedAt: null` si la cuenta no está dada de baja o no existe, así el
 * caller nunca purga por un dato faltante. Interno, mismo criterio que `kyc-status`: no se
 * declara en `gateway/src/config/routes-map.ts`.
 */
export default async function usersDeletionInternalRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const userRepository = createUserRepository(app.db);

  app.post(
    "/users/deletion-status",
    {
      schema: {
        hide: true,
        body: deletionStatusSchemas.body,
        response: { 200: deletionStatusSchemas.response },
      },
    },
    async (request: FastifyRequest): Promise<DeletionStatusResponse> => {
      const ids = [...new Set((request.body as { ids: string[] }).ids)];
      const deletionDates = await userRepository.findDeletionDatesByIds(ids);
      return {
        users: ids.map((id) => ({ id, deletedAt: deletionDates.get(id)?.toISOString() ?? null })),
      };
    },
  );
}
