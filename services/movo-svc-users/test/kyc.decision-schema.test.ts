import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { KYC_DECISION_NAME_RULES, PERSON_NAME_FIELD_PATTERN, ADMIN_KYC_NAME_MAX_LENGTH } from "@movo/shared";

const body = {
  type: "object",
  required: ["decision", "reason"],
  ...KYC_DECISION_NAME_RULES,
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["approved", "rejected"] },
    reason: { type: "string", minLength: 1 },
    firstName: { type: "string", minLength: 1, maxLength: ADMIN_KYC_NAME_MAX_LENGTH, pattern: PERSON_NAME_FIELD_PATTERN },
    lastName: { type: "string", minLength: 1, maxLength: ADMIN_KYC_NAME_MAX_LENGTH, pattern: PERSON_NAME_FIELD_PATTERN },
  },
} as const;

describe("KYC_DECISION_NAME_RULES en el JSON Schema de Fastify (reglas del cuerpo de la decisión)", () => {
  it.each([
    ["sin nombre", { decision: "approved", reason: "x" }, 200],
    ["rechazo sin nombre", { decision: "rejected", reason: "x" }, 200],
    ["aprobar con los dos", { decision: "approved", reason: "x", firstName: "Ana", lastName: "Paz" }, 200],
    ["solo el nombre", { decision: "approved", reason: "x", firstName: "Ana" }, 400],
    ["solo el apellido", { decision: "approved", reason: "x", lastName: "Paz" }, 400],
    ["rechazar con nombre", { decision: "rejected", reason: "x", firstName: "Ana", lastName: "Paz" }, 400],
    ["nombre en blanco", { decision: "approved", reason: "x", firstName: "  ", lastName: "Paz" }, 400],
  ])("%s -> %i", async (_n, payload, status) => {
    const app = Fastify();
    app.post("/d", { schema: { body } }, async () => ({ ok: true }));
    const res = await app.inject({ method: "POST", url: "/d", payload });
    expect(res.statusCode).toBe(status);
    await app.close();
  });
});
