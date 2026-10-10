import { describe, it, expect, vi, beforeEach } from "vitest";

const sdk = vi.hoisted(() => {
  const configs: Array<{ accessToken: string; options?: Record<string, unknown> }> = [];
  const calls = {
    create: vi.fn(),
    get: vi.fn(),
    capture: vi.fn(),
    cancel: vi.fn(),
    search: vi.fn(),
  };
  // Cada `new Payment(config)` recuerda con qué config se construyó, así el test
  // puede verificar que cada llamada usó el token que recibió y no otro.
  class Payment {
    constructor(private readonly config: { accessToken: string }) {}
    create(args: unknown) {
      return calls.create(this.config.accessToken, args);
    }
    get(args: unknown) {
      return calls.get(this.config.accessToken, args);
    }
    capture(args: unknown) {
      return calls.capture(this.config.accessToken, args);
    }
    cancel(args: unknown) {
      return calls.cancel(this.config.accessToken, args);
    }
    search(args: unknown) {
      return calls.search(this.config.accessToken, args);
    }
  }
  class MercadoPagoConfig {
    accessToken: string;
    options?: Record<string, unknown>;
    constructor(cfg: { accessToken: string; options?: Record<string, unknown> }) {
      this.accessToken = cfg.accessToken;
      this.options = cfg.options;
      configs.push(cfg);
    }
  }
  return { configs, calls, Payment, MercadoPagoConfig };
});

vi.mock("mercadopago", () => ({ Payment: sdk.Payment, MercadoPagoConfig: sdk.MercadoPagoConfig }));

import { MERCADOPAGO_TIMEOUT_MS, SdkMercadoPagoClient } from "../src/adapters/mercadopago-client";

describe("SdkMercadoPagoClient (MOVO-267)", () => {
  const client = new SdkMercadoPagoClient();

  beforeEach(() => {
    sdk.configs.length = 0;
    for (const fn of Object.values(sdk.calls)) {
      fn.mockReset();
      fn.mockResolvedValue({ id: 123, status: "authorized" });
    }
  });

  it("createPayment usa el token del vendedor y propaga la idempotency key", async () => {
    const body = {
      transaction_amount: 1000,
      capture: false,
      token: "card-token",
      payment_method_id: "visa",
      installments: 1,
      payer: { email: "comprador@testuser.com" },
      application_fee: 150,
    };

    const result = await client.createPayment("TEST-seller", body, "shipment-1:hold");

    expect(result).toEqual({ id: 123, status: "authorized" });
    expect(sdk.calls.create).toHaveBeenCalledWith("TEST-seller", {
      body,
      requestOptions: { idempotencyKey: "shipment-1:hold" },
    });
  });

  it("getPayment usa el token del vendedor y no manda idempotency key", async () => {
    await client.getPayment("TEST-seller", 123);

    expect(sdk.calls.get).toHaveBeenCalledWith("TEST-seller", { id: 123 });
  });

  it("capturePayment total no manda transaction_amount", async () => {
    await client.capturePayment("TEST-seller", 123, { idempotencyKey: "shipment-1:capture" });

    expect(sdk.calls.capture).toHaveBeenCalledWith("TEST-seller", {
      id: 123,
      requestOptions: { idempotencyKey: "shipment-1:capture" },
    });
  });

  it("capturePayment parcial manda el monto como transaction_amount", async () => {
    await client.capturePayment("TEST-seller", 123, { idempotencyKey: "k", amount: 800 });

    expect(sdk.calls.capture).toHaveBeenCalledWith("TEST-seller", {
      id: 123,
      transaction_amount: 800,
      requestOptions: { idempotencyKey: "k" },
    });
  });

  it("cancelPayment usa el token del vendedor y propaga la idempotency key", async () => {
    await client.cancelPayment("TEST-seller", 123, "shipment-1:release");

    expect(sdk.calls.cancel).toHaveBeenCalledWith("TEST-seller", {
      id: 123,
      requestOptions: { idempotencyKey: "shipment-1:release" },
    });
  });

  it("arma una config nueva por llamada, con el timeout acotado", async () => {
    await client.getPayment("TEST-seller-a", 1);
    await client.getPayment("TEST-seller-b", 2);

    expect(sdk.configs).toEqual([
      { accessToken: "TEST-seller-a", options: { timeout: MERCADOPAGO_TIMEOUT_MS } },
      { accessToken: "TEST-seller-b", options: { timeout: MERCADOPAGO_TIMEOUT_MS } },
    ]);
  });

  it("propaga los errores del SDK sin envolverlos", async () => {
    const mpError = Object.assign(new Error("Invalid users involved"), { status: 400, cause: [{ code: 2034 }] });
    sdk.calls.create.mockRejectedValue(mpError);

    await expect(client.createPayment("TEST-seller", {}, "k")).rejects.toBe(mpError);
  });

  it("searchPaymentsByExternalReference busca con el token del vendedor y devuelve el resumen (MOVO-209)", async () => {
    sdk.calls.search.mockResolvedValue({
      results: [
        { id: "777", status: "authorized", status_detail: "pending_capture", external_reference: "ship-1", other: 1 },
      ],
    });

    const found = await client.searchPaymentsByExternalReference("TEST-seller", "ship-1");

    expect(sdk.calls.search).toHaveBeenCalledWith(
      "TEST-seller",
      expect.objectContaining({ options: expect.objectContaining({ external_reference: "ship-1" }) })
    );
    expect(found).toEqual([{ id: "777", status: "authorized", status_detail: "pending_capture" }]);
  });

  it("searchPaymentsByExternalReference sin resultados devuelve una lista vacía", async () => {
    sdk.calls.search.mockResolvedValue({});
    expect(await client.searchPaymentsByExternalReference("TEST-seller", "ship-1")).toEqual([]);
  });
});
