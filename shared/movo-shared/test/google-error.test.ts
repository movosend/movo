import { describe, expect, it } from "vitest";
import { googleErrorDetail, readGoogleErrorDetail } from "../src/utils/google-error";

describe("google-error: detalle de un rechazo de Google para el log", () => {
  it("lee la forma de las APIs v1/v2 ({error: {status, message}})", async () => {
    const response = new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Billing" } }), { status: 403 });
    await expect(readGoogleErrorDetail(response)).resolves.toEqual({ httpStatus: 403, googleStatus: "PERMISSION_DENIED", googleMessage: "Billing" });
  });

  it("lee la forma de Geocoding ({status, error_message}) y recorta mensajes largos", () => {
    const detail = googleErrorDetail(200, { status: "REQUEST_DENIED", error_message: "x".repeat(500) });
    expect(detail.googleStatus).toBe("REQUEST_DENIED");
    expect(detail.googleMessage).toHaveLength(300);
  });

  it("con un body que no es JSON queda solo el status HTTP", async () => {
    await expect(readGoogleErrorDetail(new Response("<html>", { status: 500 }))).resolves.toEqual({ httpStatus: 500, googleStatus: null, googleMessage: null });
  });
});
