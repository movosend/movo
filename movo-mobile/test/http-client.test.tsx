import { ApiError } from "@movo/shared/dist/errors/api-error";

const originalEnv = process.env.EXPO_PUBLIC_API_URL;

describe("http-client", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api-dev.movosend.app";
    jest.resetModules();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalEnv;
  });

  it("arma la URL con el prefijo /api/v1 y EXPO_PUBLIC_API_URL", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");
    await httpClient.get("/kyc/status", { userId: "usr_1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-dev.movosend.app/api/v1/kyc/status?userId=usr_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("parsea SerializedApiError y lanza un ApiError tipado", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: "USER_EMAIL_ALREADY_EXISTS", message: "Ya existe", statusCode: 409 },
      }),
    });
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");

    await expect(httpClient.post("/auth/register", {})).rejects.toMatchObject({
      code: "USER_EMAIL_ALREADY_EXISTS",
      statusCode: 409,
    } satisfies Partial<ApiError>);
  });

  it("lanza INTERNAL_ERROR de red si fetch falla", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("network down"));
    // @ts-expect-error mock global
    global.fetch = fetchMock;

    const { httpClient } = require("../src/api/http-client");

    await expect(httpClient.get("/kyc/status")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
