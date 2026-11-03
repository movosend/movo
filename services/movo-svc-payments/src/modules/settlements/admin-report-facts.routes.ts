import { FastifyInstance, FastifyRequest } from "fastify";
import { PAYMENT_REPORT_FACTS_MAX_IDS, PaymentReportFact, PaymentReportFactsRequest, PaymentReportFactsResponse } from "@movo/shared";

const toNumber = (value: { toNumber(): number } | null | undefined): number | null => (value ? value.toNumber() : null);

/**
 * MOVO-35 (ADR-025): lo que este servicio sabe del cobro de una lista de envíos, para Cashflow y Precio y volumen. Los
 * envíos, sus fechas y su tramo viven en `svc-shipments`; `svc-admin` cruza las dos cosas. Interna, sin datos personales.
 */
export default async function paymentsAdminReportFactsRoutes(app: FastifyInstance) {
  app.post(
    "/report-facts",
    {
      schema: {
        hide: true,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["shipmentIds"],
          properties: { shipmentIds: { type: "array", maxItems: PAYMENT_REPORT_FACTS_MAX_IDS, items: { type: "string", format: "uuid" } } },
        },
      },
    },
    async (request: FastifyRequest): Promise<PaymentReportFactsResponse> => {
      const { shipmentIds } = request.body as PaymentReportFactsRequest;
      if (shipmentIds.length === 0) return { items: [] };

      const where = { shipmentId: { in: shipmentIds } };
      const [settlements, refunds, holds, cash] = await Promise.all([
        app.db.settlement.findMany({
          where: { ...where, kind: { in: ["delivery", "dispute_partial"] } },
          select: { shipmentId: true, status: true, grossAmountArs: true, debtSurchargeArs: true, commissionArs: true },
        }),
        app.db.refund.findMany({ where: { ...where, status: { in: ["succeeded", "fallback_to_ledger"] } }, select: { shipmentId: true, amountArs: true } }),
        app.db.hold.findMany({
          where,
          orderBy: { attempt: "asc" },
          select: { shipmentId: true, status: true, wasAuthorized: true, statusDetail: true, commissionArs: true },
        }),
        app.db.cashShipmentPayment.findMany({ where, select: { shipmentId: true, commissionArs: true, ledgerEntry: { select: { status: true } } } }),
      ]);

      const facts = new Map<string, PaymentReportFact>();
      const factOf = (shipmentId: string): PaymentReportFact => {
        let fact = facts.get(shipmentId);
        if (!fact) {
          fact = {
            shipmentId,
            settlementStatus: null,
            capturedArs: null,
            commissionArs: null,
            holdCommissionArs: null,
            refundedArs: 0,
            holdRejected: false,
            holdExpired: false,
            cashCommissionArs: null,
            cashCommissionDebtOpen: false,
          };
          facts.set(shipmentId, fact);
        }
        return fact;
      };

      for (const row of settlements) {
        const fact = factOf(row.shipmentId);
        fact.settlementStatus = row.status;
        fact.capturedArs = row.grossAmountArs.toNumber() - row.debtSurchargeArs.toNumber();
        fact.commissionArs = toNumber(row.commissionArs);
      }
      for (const row of refunds) factOf(row.shipmentId).refundedArs += row.amountArs.toNumber();
      for (const row of holds) {
        const fact = factOf(row.shipmentId);
        fact.holdCommissionArs = toNumber(row.commissionArs);
        if (row.status === "rejected") fact.holdRejected = true;
        // Un hold autorizado que MP cancela solo: es el vencimiento (DD-050), no una liberación nuestra.
        if (row.status === "cancelled" && row.wasAuthorized && row.statusDetail === "expired") fact.holdExpired = true;
      }
      for (const row of cash) {
        const fact = factOf(row.shipmentId);
        fact.cashCommissionArs = toNumber(row.commissionArs);
        fact.cashCommissionDebtOpen = row.ledgerEntry?.status === "pending" || row.ledgerEntry?.status === "reserved";
      }
      return { items: [...facts.values()] };
    },
  );
}
