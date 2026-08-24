import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { createAddressesService } from "./addresses.service";
import { addressesSchemas } from "./addresses.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { CreateAddressInput, UpdateAddressInput } from "../../models/address";

export type AddressesRoutesOptions = FastifyPluginOptions;

export default async function addressesRoutes(
  app: FastifyInstance,
  _opts: AddressesRoutesOptions,
) {
  const service = createAddressesService(app.db);

  app.get(
    "/",
    {
      schema: {
        summary: "Listar direcciones guardadas",
        description:
          "MOVO-119: direcciones propias del usuario autenticado, default primero, " +
          "luego por createdAt descendente. Ruta protegida: el userId sale del header " +
          "x-user-id inyectado por el gateway (ADR-010).",
        tags: ["addresses"],
        response: {
          200: addressesSchemas.listResponse,
          401: addressesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      return service.listMyAddresses(userId);
    },
  );

  app.post(
    "/",
    {
      schema: {
        summary: "Crear dirección guardada",
        description:
          "MOVO-119: la primera dirección del usuario se fuerza isDefault:true sin " +
          "importar lo que mande el cliente. Si se manda isDefault:true en cualquier " +
          "otro caso, desmarca la default anterior en la misma transacción.",
        tags: ["addresses"],
        body: addressesSchemas.createBody,
        response: {
          201: addressesSchemas.addressResponse,
          400: addressesSchemas.errorResponse,
          401: addressesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUserIdFromHeader(request);
      const body = request.body as CreateAddressInput;
      const address = await service.createAddress(userId, body);
      reply.code(201);
      return address;
    },
  );

  app.patch(
    "/:id",
    {
      schema: {
        summary: "Actualizar dirección guardada",
        description:
          "MOVO-119: update parcial. isDefault:true dispara el mismo swap atómico " +
          "que en la creación. 403 si la dirección no pertenece al caller (nunca 404 " +
          "filtrado, mismo criterio que GET /shipments/:id de MOVO-80).",
        tags: ["addresses"],
        params: addressesSchemas.addressIdParam,
        body: addressesSchemas.updateBody,
        response: {
          200: addressesSchemas.addressResponse,
          400: addressesSchemas.errorResponse,
          401: addressesSchemas.errorResponse,
          403: addressesSchemas.errorResponse,
          404: addressesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as UpdateAddressInput;
      return service.updateAddress(id, userId, body);
    },
  );

  app.delete(
    "/:id",
    {
      schema: {
        summary: "Borrar dirección guardada",
        description:
          "MOVO-119: si la dirección borrada era la default y quedan otras, promueve " +
          "la más reciente (createdAt desc) a default automáticamente. 403 si la " +
          "dirección no pertenece al caller (nunca 404 filtrado).",
        tags: ["addresses"],
        params: addressesSchemas.addressIdParam,
        response: {
          204: { type: "null", description: "Sin contenido" },
          401: addressesSchemas.errorResponse,
          403: addressesSchemas.errorResponse,
          404: addressesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      await service.deleteAddress(id, userId);
      reply.code(204);
    },
  );
}
