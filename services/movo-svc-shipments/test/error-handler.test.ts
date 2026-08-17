import Fastify, { FastifyInstance } from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import errorHandlerPlugin from "../src/plugins/error-handler";
import { InsufficientCreationPhotosError } from "../src/domain/shipment-state-machine";

describe("error-handler: InsufficientCreationPhotosError", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("se traduce a un 409 con el código SHIPMENT_INSUFFICIENT_CREATION_PHOTOS en vez de un 500 genérico", async () => {
    // Fix de review (PR #76, tmvergara): InsufficientCreationPhotosError extendía
    // `Error` a secas y nada la traducía a ApiError -- sin este caso en el error
    // handler, el gate de AC6 (`shipment-repository.ts#updateStatus()`) devolvía un 500
    // opaco apenas quedara alcanzable por HTTP (MOVO-16), en vez de un 4xx accionable.
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    app.get("/boom", async () => {
      throw new InsufficientCreationPhotosError("shipment-id", 1);
    });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SHIPMENT_INSUFFICIENT_CREATION_PHOTOS");
  });
});
