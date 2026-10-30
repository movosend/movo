import { ApiError } from "@movo/shared/dist/errors/api-error";
import { shouldRetryQuery } from "../src/lib/query-client";

// MOVO-346 (punto 6): reintentar un 429 agrava el rate limit de nginx que lo causó.
describe("shouldRetryQuery", () => {
  it("no reintenta un 4xx, incluido el 429", () => {
    expect(shouldRetryQuery(0, new ApiError(429, "RATE_LIMIT_EXCEEDED", "Too many requests"))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(404, "NOT_FOUND", "No existe"))).toBe(false);
  });

  it("reintenta red y 5xx hasta 2 veces", () => {
    const network = new ApiError(0, "INTERNAL_ERROR", "Sin conexión");
    expect(shouldRetryQuery(0, network)).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(503, "INTERNAL_ERROR", "Caído"))).toBe(true);
    expect(shouldRetryQuery(2, network)).toBe(false);
  });
});
