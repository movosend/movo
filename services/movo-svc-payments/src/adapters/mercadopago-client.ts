import { MercadoPagoConfig, Payment } from "mercadopago";

// El SDK no exporta estos tipos desde su índice: se derivan de `Payment` en vez de
// importarlos de `mercadopago/dist/...`, que es estructura interna del paquete.
export type PaymentCreateRequest = Parameters<Payment["create"]>[0]["body"];
export type PaymentResponse = Awaited<ReturnType<Payment["get"]>>;

/**
 * Lo mínimo de un pago que necesita `svc-payments` para decidir el estado de un hold.
 * `PaymentResponse` (get/create/cancel) lo satisface; el resultado de una búsqueda es un
 * resumen con `id` string, por eso no se usa `PaymentResponse` a secas.
 */
export interface PaymentSnapshot {
  id?: string | number;
  status?: string;
  status_detail?: string;
}

/**
 * MOVO-267: única puerta de `svc-payments` hacia la Payments API de Mercado Pago
 * (docs/payments/flujo-de-pagos.md §2). Cada operación recibe el access_token OAuth
 * del transportista: en el modelo Marketplace el pago se crea, captura y cancela con
 * la cuenta del vendedor, y `application_fee` solo es válido con ese token (con el de
 * la app, MP responde 2059 — SOLUCION-FINAL §6).
 *
 * Las escrituras exigen `idempotencyKey`: si se omite, el SDK genera una al azar en
 * cada llamada, y un reintento del caller crearía un segundo hold o una segunda
 * captura (flujo-de-pagos §7). La key la deriva quien llama (MOVO-209/212) de algo
 * estable, como el id del envío.
 *
 * El canje y el refresh de OAuth NO van acá: se hacen con `fetch` propio en
 * MOVO-111/243, porque `OAuth.create()` del SDK no tipa `code_verifier`/`test_token`
 * y exige un access token de la app que `/oauth/token` no usa (SOLUCION-FINAL §4).
 */
export interface MercadoPagoClient {
  createPayment(
    accessToken: string,
    body: PaymentCreateRequest,
    idempotencyKey: string
  ): Promise<PaymentResponse>;
  getPayment(accessToken: string, paymentId: string | number): Promise<PaymentResponse>;
  /** Sin `amount` captura el total autorizado; con `amount`, una captura parcial. */
  capturePayment(
    accessToken: string,
    paymentId: string | number,
    opts: { idempotencyKey: string; amount?: number }
  ): Promise<PaymentResponse>;
  /**
   * Pagos del vendedor con ese `external_reference` (el id del envío), del más nuevo al
   * más viejo. Permite recuperar un hold cuya respuesta se perdió (timeout) sin crear un
   * segundo pago (MOVO-209, review de PR #226).
   */
  searchPaymentsByExternalReference(accessToken: string, externalReference: string): Promise<PaymentSnapshot[]>;
  /** Libera un hold sin cobrar (`status: cancelled`). */
  cancelPayment(
    accessToken: string,
    paymentId: string | number,
    idempotencyKey: string
  ): Promise<PaymentResponse>;
}

/**
 * El default real del SDK es 60s (`AppConfig.DEFAULT_TIMEOUT`), demasiado para un
 * request que el emisor está esperando con la app abierta. El SDK además reintenta
 * una vez (`AppConfig.DEFAULT_RETRIES = 2` intentos en total, 2s de espera) ante errores
 * 5xx o timeout, con la misma idempotency key: el peor caso de una llamada es
 * ~22s (10s + 2s + 10s), no 10s. `retries` no es configurable desde `MercadoPagoConfig`
 * (el tipo `Options` no lo expone), así que se acepta ese techo.
 */
export const MERCADOPAGO_TIMEOUT_MS = 10_000;

export class SdkMercadoPagoClient implements MercadoPagoClient {
  constructor(private readonly timeoutMs: number = MERCADOPAGO_TIMEOUT_MS) {}

  createPayment(
    accessToken: string,
    body: PaymentCreateRequest,
    idempotencyKey: string
  ): Promise<PaymentResponse> {
    return this.payments(accessToken).create({ body, requestOptions: { idempotencyKey } });
  }

  getPayment(accessToken: string, paymentId: string | number): Promise<PaymentResponse> {
    return this.payments(accessToken).get({ id: paymentId });
  }

  capturePayment(
    accessToken: string,
    paymentId: string | number,
    opts: { idempotencyKey: string; amount?: number }
  ): Promise<PaymentResponse> {
    return this.payments(accessToken).capture({
      id: paymentId,
      ...(opts.amount !== undefined ? { transaction_amount: opts.amount } : {}),
      requestOptions: { idempotencyKey: opts.idempotencyKey },
    });
  }

  async searchPaymentsByExternalReference(
    accessToken: string,
    externalReference: string
  ): Promise<PaymentSnapshot[]> {
    const result = await this.payments(accessToken).search({
      options: { external_reference: externalReference, sort: "date_created", criteria: "desc", limit: 20 },
    });
    return (result.results ?? []).map((p) => ({ id: p.id, status: p.status, status_detail: p.status_detail }));
  }

  cancelPayment(
    accessToken: string,
    paymentId: string | number,
    idempotencyKey: string
  ): Promise<PaymentResponse> {
    return this.payments(accessToken).cancel({ id: paymentId, requestOptions: { idempotencyKey } });
  }

  /**
   * Una instancia nueva por llamada, no una por token cacheada: `Payment` hace
   * `Object.assign` de los `requestOptions` sobre `config.options` y los deja ahí,
   * así que reusarla arrastraría la idempotency key de una escritura a la siguiente.
   */
  private payments(accessToken: string): Payment {
    return new Payment(new MercadoPagoConfig({ accessToken, options: { timeout: this.timeoutMs } }));
  }
}
