import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { createKycService, DiditWebhookPayload } from "./kyc.service";
import { kycSchemas } from "./kyc.schema";
import { createDiditClient, DiditClient } from "../../adapters/didit-client";
import { requireUserIdFromHeader } from "../../utils/require-user-id";

export interface KycRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración — evita depender de red/credenciales
   * reales de Didit.me, mismo criterio que `smsProvider` en `auth.routes.ts`. */
  diditClient?: DiditClient;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Body crudo del request, capturado por el content-type parser scoped de este
     * módulo — necesario para verificar la firma del webhook (AC5) sobre los bytes
     * exactos que mandó Didit, no sobre una reserialización de `request.body`. */
    rawBody?: Buffer;
  }
}

export default async function kycRoutes(app: FastifyInstance, opts: KycRoutesOptions) {
  const diditClient = opts.diditClient ?? createDiditClient(app.config);
  const service = createKycService(app.db, diditClient, app.config.DIDIT_WEBHOOK_SECRET, app.log);

  // Content-type parser scoped a este plugin: Fastify encapsula `addContentTypeParser`
  // por contexto de registro, así que esto NO afecta a `/auth/*` ni `/users/*`
  // (plugins hermanos registrados aparte en app.ts) — verificado con un test dedicado
  // en test/kyc.raw-body-isolation.test.ts.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const buffer = body as Buffer;
    request.rawBody = buffer;
    if (buffer.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(buffer.toString("utf8")));
    } catch {
      // ApiError (no un SyntaxError crudo) para que el error-handler central lo
      // reconozca (`error instanceof ApiError`) y devuelva 400, no el 500 genérico —
      // un content-type parser error no pasa por el chequeo de validación de AJV.
      done(new ApiError(400, "VALIDATION_FAILED", "Body no es JSON válido."), undefined);
    }
  });

  app.post(
    "/session",
    {
      schema: {
        summary: "Crear sesión de verificación KYC",
        description:
          "Crea una sesión de verificación en Didit.me para el usuario autenticado y devuelve " +
          "el sessionToken que el cliente móvil pasa al SDK nativo de Didit (AC1). Solo " +
          "permitido si el teléfono está verificado y el kyc_status actual lo permite (AC2). " +
          "Ruta protegida: requiere Authorization Bearer, el userId se deriva del token " +
          "(revisión de PR #51, reemplaza el diseño sin JWT original — ver MOVO-94).",
        tags: ["kyc"],
        response: {
          201: kycSchemas.kycSessionResponse,
          400: kycSchemas.errorResponse,
          401: kycSchemas.errorResponse,
          404: kycSchemas.errorResponse,
          409: kycSchemas.errorResponse,
          502: kycSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUserIdFromHeader(request);
      const result = await service.createSession(userId);
      reply.code(201);
      return result;
    }
  );

  app.get(
    "/status",
    {
      schema: {
        summary: "Consultar estado de KYC",
        description:
          "Permite al cliente móvil hacer polling del estado mientras la verificación está " +
          "en curso (AC8). Ruta protegida: requiere Authorization Bearer, el userId se " +
          "deriva del token (revisión de PR #51 — ver MOVO-94).",
        tags: ["kyc"],
        response: {
          200: kycSchemas.kycStatusResponse,
          401: kycSchemas.errorResponse,
          404: kycSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      return service.getStatus(userId);
    }
  );

  app.post(
    "/webhook",
    {
      schema: {
        summary: "Webhook de resultado de KYC (Didit.me)",
        description:
          "Recibe el resultado asincrónico de la verificación (AC4). Valida la firma " +
          "(X-Signature-V2) y el timestamp (X-Timestamp) antes de procesar (AC5). " +
          "Idempotente (AC7): responde 200 aunque el evento sea un duplicado, un " +
          "session_id desconocido, o un estado intermedio no terminal — Didit reintenta " +
          "si no recibe 2xx, así que ignorar sin fallar evita reintentos infinitos sobre " +
          "un evento que nunca se va a poder procesar distinto.",
        tags: ["kyc"],
        response: {
          200: { type: "object" },
          401: kycSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
      await service.handleWebhook(
        rawBody,
        request.headers["x-signature-v2"],
        request.headers["x-timestamp"],
        (request.body ?? {}) as DiditWebhookPayload
      );
      reply.code(200);
      return {};
    }
  );
}
