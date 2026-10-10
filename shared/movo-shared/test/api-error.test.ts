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
    expect(error.toJSON().error).not.toHaveProperty("details");
  });

  it("incluye details solo cuando el error los trae (MOVO-116)", () => {
    const error = new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "Falta la licencia", {
      missingRequirements: ["license", "mp_account"],
    });

    expect(error.details).toEqual({ missingRequirements: ["license", "mp_account"] });
    expect(error.toJSON()).toEqual({
      error: {
        code: "CARRIER_LICENSE_NOT_APPROVED",
        message: "Falta la licencia",
        statusCode: 403,
        details: { missingRequirements: ["license", "mp_account"] },
      },
    });
  });
});
