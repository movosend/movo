import { FastifyInstance } from "fastify";
import { debtCollectionPreviewInternalSchema, getBalanceSchema } from "./user-ledger.schema";
import type { DebtCollectionPreviewRequest } from "@movo/shared";

/**
 * MOVO-309: `GET /payments/balance`, la cuenta corriente del usuario autenticado. Se registra
 * dentro de `paymentsRoutes` para heredar su hook de `x-user-id`; solo ve lo suyo.
 */
export default async function userLedgerRoutes(app: FastifyInstance) {
  app.post("/debt-preview", {
    schema: { ...debtCollectionPreviewInternalSchema, hide: false, params: undefined },
  }, async (request) => {
    const raw = request.headers["x-user-id"];
    const userId = (Array.isArray(raw) ? raw[0] : raw) as string;
    return app.holds.previewCarrierDebt(userId, (request.body as DebtCollectionPreviewRequest).amountsArs);
  });
  app.get("/", { schema: getBalanceSchema }, async (request) => {
    const raw = request.headers["x-user-id"];
    const userId = (Array.isArray(raw) ? raw[0] : raw) as string;
    const { cursor, limit } = request.query as { cursor?: string; limit?: number };
    const page = await app.userLedger.page(userId, { cursor, limit });
    const shipmentIds = [...new Set(page.items.map((item) => item.shipmentId).filter((id): id is string => !!id))];
    const paymentIds = [...new Set(page.items.filter((item) => item.type === "voluntary_payment").map((item) => item.paymentId).filter((id): id is string => !!id))];
    const attempts = paymentIds.length
      ? await app.db.balancePaymentAttempt.findMany({
        where: { userId, mpPaymentId: { in: paymentIds } },
        select: { mpPaymentId: true, savedCardId: true },
      })
      : [];
    const cardIds = attempts.map((attempt) => attempt.savedCardId).filter((id): id is string => !!id);
    const cards = cardIds.length
      ? await app.db.savedCard.findMany({
        where: { userId, id: { in: cardIds } },
        select: { id: true, brand: true, last4: true },
      })
      : [];
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    const paymentLabels = new Map(attempts.map((attempt) => {
      const card = attempt.savedCardId ? cardsById.get(attempt.savedCardId) : null;
      const brand = card ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : null;
      return [attempt.mpPaymentId, card ? `${brand} •••• ${card.last4}` : "Pago de saldo"];
    }));
    let byId = new Map<string, string>();
    if (shipmentIds.length > 0) {
      try {
        const response = await fetch(`${app.config.SHIPMENTS_SERVICE_URL}/internal/ledger-origins`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, shipmentIds }),
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const origins = await response.json() as Array<{ id: string; label: string }>;
          byId = new Map(origins.map((origin) => [origin.id, origin.label]));
        }
      } catch {
        // El saldo sigue disponible si shipments no puede resolver el nombre de origen.
      }
    }
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        originLabel: item.shipmentId
          ? byId.get(item.shipmentId) ?? null
          : item.paymentId ? paymentLabels.get(item.paymentId) ?? null : null,
      })),
    };
  });
}
