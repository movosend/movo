import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { createDeviceKeyRepository } from "../../repositories/device-key-repository";
import { deviceKeysSchemas } from "./device-keys.schema";

/**
 * MOVO-157 AC3/AC4: consultado por `movo-svc-shipments` (ticket hermano MOVO-158)
 * para resolver la clave pública vigente de un usuario al validar la firma de un
 * handshake criptográfico. Interno -- no se declara en
 * `gateway/src/config/routes-map.ts`, así que el gateway no lo proxea (mismo criterio
 * de confianza perimetral de ADR-010 que `/internal/notifications`, MOVO-106).
 */
export default async function deviceKeysRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const deviceKeyRepository = createDeviceKeyRepository(app.db);

  app.get(
    "/users/:id/device-key",
    {
      // No documentado en la Swagger pública -- endpoint interno, mismo criterio que
      // el resto de los módulos bajo /internal.
      schema: {
        hide: true,
        params: deviceKeysSchemas.userIdParam,
        response: {
          200: deviceKeysSchemas.deviceKeyResponse,
          404: deviceKeysSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const deviceKey = await deviceKeyRepository.findByUserId(id);
      if (!deviceKey) {
        // AC4: 404 explícito -- svc-shipments no puede iniciar/confirmar un handshake
        // sin clave, y necesita distinguir ese caso de un error de transporte.
        throw new ApiError(404, "DEVICE_KEY_NOT_FOUND", "El usuario no tiene una clave de dispositivo registrada.");
      }
      return {
        publicKey: deviceKey.publicKey,
        registeredAt: deviceKey.updatedAt.toISOString(),
      };
    },
  );
}
