import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { AccountStatus, ApiError, CarrierKycStatusResponse } from "@movo/shared";
import { createUserRepository } from "../../repositories/user-repository";

// Autocontenido a propósito, mismo criterio que el resto de los módulos.
const kycInternalSchemas = {
  userIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },
  kycStatusResponse: {
    type: "object",
    required: ["kycStatusIdentity", "kycStatusLicense"],
    properties: {
      kycStatusIdentity: { type: "string" },
      kycStatusLicense: { type: "string" },
    },
  },
  errorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "statusCode"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          statusCode: { type: "integer" },
        },
      },
      requestId: { type: "string" },
    },
  },
};

/**
 * MOVO-116 (ADR-036): consultado por `movo-svc-shipments` para bloquear declarar viaje,
 * ofertar, editar oferta e iniciar viaje sin licencia aprobada. Devuelve los dos estados
 * de KYC en crudo, más liviano que `GET /users/:id` (que además pide la reputación a
 * `svc-shipments`). Interno -- no se declara en `gateway/src/config/routes-map.ts`,
 * mismo criterio que `/internal/users/:id/device-key` (MOVO-157).
 */
export default async function kycInternalRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const userRepository = createUserRepository(app.db);

  app.get(
    "/users/:id/kyc-status",
    {
      schema: {
        hide: true,
        params: kycInternalSchemas.userIdParam,
        response: {
          200: kycInternalSchemas.kycStatusResponse,
          404: kycInternalSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest): Promise<CarrierKycStatusResponse> => {
      const { id } = request.params as { id: string };
      const user = await userRepository.findById(id);
      // Mismo criterio que `GET /users/:id` (MOVO-77): una cuenta dada de baja no existe.
      if (!user || user.status === AccountStatus.DELETED) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return {
        kycStatusIdentity: user.kycStatusIdentity,
        kycStatusLicense: user.kycStatusLicense,
      };
    },
  );
}
