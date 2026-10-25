import type { FastifyBaseLogger } from "fastify";
import {
  ApiError,
  CardsCheckoutDataResponse,
  CreateSavedCardRequest,
  MAX_SAVED_CARDS_PER_USER,
  SAVED_CARD_ALIAS_MAX_LENGTH,
  SavedCard as SavedCardDto,
} from "@movo/shared";
import type { MercadoPagoCustomersClient, MpSavedCard } from "../../adapters/mercadopago-customers-client";
import { MercadoPagoCustomersError } from "../../adapters/mercadopago-customers-client";
import type { UsersClient } from "../../adapters/users-client";
import type { SavedCard, SavedCardRepository } from "../../repositories/saved-card-repository";

export interface CardsServiceDeps {
  cards: SavedCardRepository;
  mercadoPago: MercadoPagoCustomersClient;
  users: UsersClient;
  log: FastifyBaseLogger;
  /** `MP_PUBLIC_KEY`; vacío o ausente = no configurada. */
  publicKey: string | undefined;
  /** `MP_TEST_MODE`. */
  testMode: boolean;
  /** `MP_TEST_PAYER_EMAILS` crudo (JSON), solo se respeta con `testMode`. */
  testPayerEmailsRaw: string | undefined;
}

export interface CardsService {
  getCheckoutData(): CardsCheckoutDataResponse;
  create(userId: string, input: CreateSavedCardRequest): Promise<{ card: SavedCardDto; created: boolean }>;
  list(userId: string): Promise<SavedCardDto[]>;
  setDefault(userId: string, id: string): Promise<SavedCardDto>;
  updateAlias(userId: string, id: string, alias: string | null | undefined): Promise<SavedCardDto>;
  remove(userId: string, id: string): Promise<void>;
  /** Baja de cuenta (MOVO-39): best-effort contra MP, siempre borra lo local. */
  removeAllForUser(userId: string): Promise<void>;
}

export function toSavedCardDto(card: SavedCard): SavedCardDto {
  return {
    id: card.id,
    mpCardId: card.mpCardId,
    alias: card.alias,
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    issuerName: card.issuerName,
    paymentType: card.paymentType,
    isDefault: card.isDefault,
    createdAt: card.createdAt.toISOString(),
  };
}

// Caracteres de control C0/C1: un alias no es lugar para saltos de línea ni invisibles.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const CARD_NUMBER_LIKE = /\d{12,}/;

/**
 * Valida y normaliza el nombre de referencia (AC11). `null` si no hay alias (ausente, `null`
 * o vacío tras el trim). Rechaza una secuencia de 12+ dígitos para que nadie escriba el
 * número de la tarjeta ahí; los espacios y guiones se ignoran al contar ("4111 1111 1111
 * 1111" también se rechaza).
 */
export function normalizeAlias(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const alias = raw.trim();
  if (alias === "") return null;
  if (alias.length > SAVED_CARD_ALIAS_MAX_LENGTH) {
    throw new ApiError(400, "VALIDATION_FAILED", `El nombre de la tarjeta puede tener hasta ${SAVED_CARD_ALIAS_MAX_LENGTH} caracteres.`);
  }
  if (CONTROL_CHARS.test(alias)) {
    throw new ApiError(400, "VALIDATION_FAILED", "El nombre de la tarjeta tiene caracteres no permitidos.");
  }
  if (CARD_NUMBER_LIKE.test(alias.replace(/[\s-]/g, ""))) {
    throw new ApiError(400, "VALIDATION_FAILED", "El nombre de la tarjeta no puede contener el número de la tarjeta.");
  }
  return alias;
}

/** Mapa `userId -> email` de `MP_TEST_PAYER_EMAILS`; JSON inválido equivale a mapa vacío. */
function parseTestPayerEmails(raw: string | undefined, log: FastifyBaseLogger): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("no es un objeto");
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0
      )
    );
  } catch {
    log.warn("MP_TEST_PAYER_EMAILS no es un JSON válido {userId: email}: se ignora");
    return {};
  }
}

function notFound(): ApiError {
  return new ApiError(404, "NOT_FOUND", "Tarjeta no encontrada.");
}

/** Falla de MP que no es un rechazo de la tarjeta: el cliente puede reintentar. */
function providerUnavailable(): ApiError {
  return new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no respondió. Probá de nuevo en unos minutos.");
}

export function createCardsService(deps: CardsServiceDeps): CardsService {
  const { cards, mercadoPago, users, log } = deps;
  const testPayerEmails = deps.testMode ? parseTestPayerEmails(deps.testPayerEmailsRaw, log) : {};

  /** Email con el que se crea el customer: el de la cuenta, salvo el override de sandbox. */
  async function resolveCustomerEmail(userId: string): Promise<string> {
    const override = testPayerEmails[userId];
    if (override) return override;
    const email = await users.findAccountEmail(userId);
    if (!email) {
      throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "No se pudo resolver el email de la cuenta del emisor.");
    }
    if (deps.testMode) {
      log.warn(
        { userId },
        "Sandbox: el usuario no está en MP_TEST_PAYER_EMAILS, el customer se crea con el email de su cuenta de Movo (MP puede responder 225)"
      );
    }
    return email;
  }

  /** Customer del emisor en la cuenta de Movo: el guardado, o uno nuevo (o el que ya existía en MP). */
  async function ensureCustomerId(userId: string): Promise<string> {
    const existing = await cards.findCustomer(userId);
    if (existing) return existing.mpCustomerId;

    const email = await resolveCustomerEmail(userId);
    let mpCustomerId: string;
    try {
      mpCustomerId = (await mercadoPago.createCustomer(email)).id;
    } catch (error) {
      if (error instanceof MercadoPagoCustomersError && error.isCustomerAlreadyExists) {
        // El email ya tiene customer (alta anterior sin fila local, o el de otra cuenta que
        // usó ese email antes): se adopta solo si no es de otro usuario, lo chequea saveCustomer.
        const found = await mercadoPago.findCustomerByEmail(email).catch(() => null);
        if (!found) throw providerUnavailable();
        mpCustomerId = found.id;
      } else {
        throw mapCustomerError(error, "No se pudo crear el cliente en Mercado Pago.");
      }
    }
    const saved = await cards.saveCustomer(userId, mpCustomerId);
    if (!saved) {
      // Nunca se comparte un customer: los holds de uno se cobrarían como el otro y la baja de
      // cuenta de uno le borraría las tarjetas al otro. Queda para resolver a mano.
      log.error({ userId, mpCustomerId }, "El customer de MP del email del emisor ya es de otra cuenta");
      throw new ApiError(
        409,
        "CARD_CUSTOMER_CONFLICT",
        "No pudimos asociar tu cuenta a Mercado Pago para guardar tarjetas. Contactá a soporte."
      );
    }
    return saved.mpCustomerId;
  }

  /**
   * ¿El 404 de MP al guardar es porque el customer ya no existe? Se confirma con un GET
   * antes de olvidarlo: un 404 por otro motivo no puede dar de baja las tarjetas del usuario.
   */
  async function isCustomerGone(error: unknown, customerId: string): Promise<boolean> {
    if (!(error instanceof MercadoPagoCustomersError) || error.status !== 404) return false;
    return !(await mercadoPago.customerExists(customerId).catch(() => true));
  }

  async function saveCardInMp(userId: string, cardToken: string): Promise<{ customerId: string; saved: MpSavedCard }> {
    const customerId = await ensureCustomerId(userId);
    try {
      return { customerId, saved: await mercadoPago.saveCard(customerId, cardToken) };
    } catch (error) {
      if (!(await isCustomerGone(error, customerId))) {
        throw mapCustomerError(error, "Mercado Pago no pudo guardar la tarjeta. Revisá los datos o probá con otra.");
      }
    }
    // El customer se borró en MP (y con él sus tarjetas): se olvida y se reintenta una vez con uno nuevo.
    const discarded = await cards.forgetCustomer(userId, customerId);
    log.warn({ userId, mpCustomerId: customerId, discardedCards: discarded }, "El customer de MP ya no existía: se crea uno nuevo");
    const freshCustomerId = await ensureCustomerId(userId);
    try {
      return { customerId: freshCustomerId, saved: await mercadoPago.saveCard(freshCustomerId, cardToken) };
    } catch (error) {
      throw mapCustomerError(error, "Mercado Pago no pudo guardar la tarjeta. Revisá los datos o probá con otra.");
    }
  }

  /** Un 4xx de MP (salvo credenciales) es un rechazo de lo que mandamos; el resto, falla del proveedor. */
  function mapCustomerError(error: unknown, rejectionMessage: string): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof MercadoPagoCustomersError) {
      const rejected = error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403 && error.status !== 429 && error.status !== 408;
      log.warn({ operation: error.operation, status: error.status, providerCode: error.providerCode }, "Falló una llamada a Customers & Cards de MP");
      if (rejected) {
        return new ApiError(422, "CARD_SAVE_REJECTED", rejectionMessage, {
          ...(error.providerCode ? { providerCode: error.providerCode } : {}),
        });
      }
      return providerUnavailable();
    }
    log.error({ err: error }, "Error inesperado hablando con Customers & Cards de MP");
    return providerUnavailable();
  }

  async function discardMpCard(customerId: string, mpCardId: string): Promise<void> {
    try {
      await mercadoPago.deleteCard(customerId, mpCardId);
    } catch (error) {
      // Huérfana en MP, inofensiva (nadie la referencia); queda registrado para limpiarla.
      log.warn({ err: error instanceof Error ? error.name : "unknown" }, "No se pudo borrar en MP una tarjeta que no quedó guardada");
    }
  }

  return {
    getCheckoutData() {
      if (!deps.publicKey) {
        throw new ApiError(503, "CARDS_NOT_CONFIGURED", "Las tarjetas guardadas no están configuradas en este ambiente.");
      }
      return { publicKey: deps.publicKey };
    },

    async create(userId, input) {
      const alias = normalizeAlias(input.alias);
      // Falla rápido, antes de gastar una llamada a MP; el tope se vuelve a chequear en la transacción.
      if ((await cards.countLive(userId)) >= MAX_SAVED_CARDS_PER_USER) {
        throw limitReached();
      }

      const { customerId, saved } = await saveCardInMp(userId, input.cardToken);

      let result;
      try {
        result = await cards.create(
          userId,
          {
            mpCardId: saved.id,
            brand: saved.brand,
            last4: saved.last4,
            expMonth: saved.expMonth,
            expYear: saved.expYear,
            issuerName: saved.issuerName,
            paymentType: saved.paymentType,
            alias,
          },
          MAX_SAVED_CARDS_PER_USER
        );
      } catch (error) {
        // MP puede devolver el id de una tarjeta que el usuario ya tenía guardada: esa no se toca.
        // Si tampoco se puede leer la base, se deja la copia en MP (huérfana, inofensiva).
        const alreadySaved = await cards
          .listLive(userId)
          .then((live) => live.some((card) => card.mpCardId === saved.id))
          .catch(() => true);
        if (!alreadySaved) await discardMpCard(customerId, saved.id);
        throw error;
      }

      if (result.kind === "limit_reached") {
        await discardMpCard(customerId, saved.id);
        throw limitReached();
      }
      if (result.kind === "duplicate") {
        // MP guardó una copia nueva de una tarjeta que ya teníamos: se descarta (si fuera el
        // mismo id, es la misma tarjeta y no hay que tocarla).
        if (result.card.mpCardId !== saved.id) await discardMpCard(customerId, saved.id);
        return { card: toSavedCardDto(result.card), created: false };
      }
      return { card: toSavedCardDto(result.card), created: true };
    },

    async list(userId) {
      return (await cards.listLive(userId)).map(toSavedCardDto);
    },

    async setDefault(userId, id) {
      const card = await cards.setDefault(userId, id);
      if (!card) throw notFound();
      return toSavedCardDto(card);
    },

    async updateAlias(userId, id, rawAlias) {
      const alias = normalizeAlias(rawAlias);
      const card = await cards.updateAlias(userId, id, alias);
      if (!card) throw notFound();
      return toSavedCardDto(card);
    },

    async remove(userId, id) {
      const card = await cards.findLive(userId, id);
      if (!card) throw notFound();
      if (await cards.hasLiveHold(card.id)) {
        throw new ApiError(409, "CARD_IN_USE", "La tarjeta tiene una reserva de fondos vigente. Podés darla de baja cuando se libere.");
      }
      const customer = await cards.findCustomer(userId);
      if (customer) {
        try {
          await mercadoPago.deleteCard(customer.mpCustomerId, card.mpCardId);
        } catch (error) {
          throw mapCustomerError(error, "Mercado Pago no pudo dar de baja la tarjeta.");
        }
      }
      await cards.softDelete(userId, id);
    },

    async removeAllForUser(userId) {
      const customer = await cards.findCustomer(userId);
      if (customer) {
        try {
          await mercadoPago.deleteCustomer(customer.mpCustomerId);
        } catch (error) {
          // La baja de cuenta no se frena por esto (DD-023): queda el id para limpiarlo a mano.
          log.error(
            { userId, mpCustomerId: customer.mpCustomerId, err: error instanceof Error ? error.name : "unknown" },
            "No se pudo borrar el customer de MP al dar de baja la cuenta; quedó huérfano"
          );
        }
      }
      await cards.deleteAllForUser(userId);
    },
  };
}

function limitReached(): ApiError {
  return new ApiError(409, "CARD_LIMIT_REACHED", `Alcanzaste el máximo de ${MAX_SAVED_CARDS_PER_USER} tarjetas guardadas.`);
}
