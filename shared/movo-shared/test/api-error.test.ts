import { describe, expect, it } from "vitest";
import { ApiError } from "../src/errors/api-error";

describe("ApiError", () => {
  it("expone statusCode, code y message", () => {
    const error = new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas");

    expect(error.statusCode).toBe(401);
    expect(error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(error.message).toBe("Credenciales inválidas");
    expect(error).toBeInstanceOf(Error);
  });

  it("serializa al formato único de error de la API", () => {
    const error = new ApiError(404, "NOT_FOUND", "Recurso no encontrado");

    expect(error.toJSON()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Recurso no encontrado",
        statusCode: 404,
      },
    });
  });
});
