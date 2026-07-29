import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import errorHandlerPlugin from "../src/plugins/error-handler";

describe("error-handler plugin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    app.get("/boom", async () => {
      throw new Error("algo inesperado que no debe llegar al cliente");
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("un error que no es ApiError responde 500 con INTERNAL_ERROR genérico", async () => {
    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
    expect(body.requestId).toBeDefined();
  });

  it("nunca filtra el mensaje interno de la excepción original", async () => {
    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.body).not.toContain("algo inesperado");
  });
});
