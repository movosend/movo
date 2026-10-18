import type { ShipmentFundingView } from "@movo/shared/dist/types/funding";
import type { HoldFailureReason } from "@movo/shared/dist/types/hold";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { FundsStatus } from "../components/shipments/funds-status";
import type { ShipmentSummary } from "../src/api/shipments-client";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

const PAY_UNTIL = "2026-10-08T13:00:00.000Z";

function shipment(funding: ShipmentFundingView | null, status: ShipmentStatus): ShipmentSummary {
  return {
    id: "ship-1",
    senderId: "sender-1",
    receiverId: "receiver-1",
    carrierId: "carrier-1",
    packageType: "standard_package",
    weightKg: 3,
    lengthCm: 40,
    widthCm: 30,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Bv. Chacabuco 850, Córdoba",
    pickupLat: -31.42,
    pickupLng: -64.18,
    deliveryAddress: "Av. del Carmen 120, Villa Allende",
    deliveryLat: -31.29,
    deliveryLng: -64.29,
    pickupDate: "2026-10-09",
    pickupTimeWindowStart: "10:00:00",
    pickupTimeWindowEnd: "13:00:00",
    suggestedPriceArs: 18000,
    highDemand: null,
    agreedPriceArs: 18400,
    paymentMethod: null,
    status,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    funding,
  };
}

function due(overrides: Partial<Extract<ShipmentFundingView, { phase: "payment_due" }>> = {}): ShipmentFundingView {
  return {
    viewer: "sender",
    phase: "payment_due",
    route: "far",
    payUntil: PAY_UNTIL,
    amountArs: 18400,
    lastAttempt: "none",
    failureReason: null,
    card: null,
    holdLost: false,
    ...overrides,
  };
}

async function renderCard(funding: ShipmentFundingView | null, status: ShipmentStatus, carrierFirstName?: string) {
  return render(<FundsStatus shipment={shipment(funding, status)} carrierFirstName={carrierFirstName} />);
}

/** AC7: ningún texto antes de `captured` afirma que se cobró. */
const DEBIT_CLAIM = /se te cobró|te cobramos|debitamos|Pago cobrado/i;

describe("FundsStatus (MOVO-211)", () => {
  afterEach(() => jest.clearAllMocks());

  it("sin funding no renderiza nada (receptor y terceros)", async () => {
    const { toJSON } = await renderCard(null, ShipmentStatus.ASSIGNED);
    expect(toJSON()).toBeNull();
  });

  describe("emisor", () => {
    it("pago pendiente con la ventana cerrada: todo en orden, fecha de apertura y nada retenido", async () => {
      const { getByTestId, getByText, queryByText, queryByTestId } = await renderCard(
        {
          viewer: "sender",
          phase: "awaiting_window",
          windowOpensAt: "2026-10-06T12:00:00.000Z",
          payUntil: PAY_UNTIL,
          amountArs: 18400,
        },
        ShipmentStatus.ASSIGNED_UNFUNDED,
        "Julieta",
      );
      expect(getByTestId("funds-status-awaiting-window")).toBeTruthy();
      expect(getByText("Todo en orden. Julieta lleva tu paquete.")).toBeTruthy();
      expect(getByText(/no se retuvo ni se cobró ningún monto/)).toBeTruthy();
      expect(getByTestId("funds-status-timeline")).toBeTruthy();
      expect(queryByTestId("funds-status-cta")).toBeNull();
      expect(queryByText(DEBIT_CLAIM)).toBeNull();
    });

    it("confirmá tu pago: monto, plazo y CTA a la pantalla de pago", async () => {
      const { getByTestId, getByText } = await renderCard(due(), ShipmentStatus.ASSIGNED_UNFUNDED, "Julieta");
      expect(getByTestId("funds-status-amount")).toHaveTextContent("$18.400");
      expect(getByText(/se cobra recién cuando Julieta entregue el paquete/)).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId("funds-status-cta"));
      });
      expect(router.push).toHaveBeenCalledWith("/(app)/shipments/ship-1/pay");
    });

    it("reserva perdida por MP: pide reconfirmar sin decir que se cobró", async () => {
      const { getByText, queryByText } = await renderCard(due({ holdLost: true }), ShipmentStatus.ASSIGNED_UNFUNDED);
      expect(getByText("Volvé a confirmar tu pago")).toBeTruthy();
      expect(getByText(/se liberó sin cobrarte nada/)).toBeTruthy();
      expect(queryByText(DEBIT_CLAIM)).toBeNull();
    });

    it("procesando: sin CTA, con la tarjeta si se conoce", async () => {
      const { getByTestId, getByText, queryByTestId } = await renderCard(
        due({ route: "near", lastAttempt: "in_process", card: { brand: "visa", lastFour: "3704" } }),
        ShipmentStatus.ASSIGNMENT_PENDING,
      );
      expect(getByText("Estamos procesando tu pago")).toBeTruthy();
      expect(getByText(/Todavía no se retuvo nada/)).toBeTruthy();
      expect(getByTestId("funds-status-card")).toHaveTextContent("Visa •••• 3704");
      expect(queryByTestId("funds-status-cta")).toBeNull();
    });

    it("pago sin terminar: CTA para retomarlo", async () => {
      const { getByText, getByTestId } = await renderCard(due({ route: "near" }), ShipmentStatus.ASSIGNMENT_PENDING);
      expect(getByText("Tu pago quedó sin terminar")).toBeTruthy();
      expect(getByTestId("funds-status-cta")).toHaveTextContent("Retomar pago");
    });

    it.each<[HoldFailureReason, RegExp]>([
      ["insufficient_funds", /fondos suficientes/],
      ["card_rejected", /rechazó la tarjeta/],
      ["invalid_data", /no coinciden/],
      ["platform_error", /No pudimos procesar/],
    ])("rechazo por %s: motivo diferenciado y CTA de reintentar con otra tarjeta (AC5)", async (reason, title) => {
      const { getByTestId, getByText } = await renderCard(
        due({ route: "near", lastAttempt: "rejected", failureReason: reason, card: { brand: "visa", lastFour: "3704" } }),
        ShipmentStatus.ASSIGNMENT_PENDING,
      );
      expect(getByTestId("funds-status-rejected-title")).toHaveTextContent(title);
      expect(getByText("No se retuvo ni se cobró nada.")).toBeTruthy();
      expect(getByTestId("funds-status-cta")).toHaveTextContent("Reintentar con otra tarjeta");

      await act(async () => {
        fireEvent.press(getByTestId("funds-status-cta"));
      });
      expect(router.push).toHaveBeenCalledWith("/(app)/shipments/ship-1/pay");
    });

    it("rechazo sin tarjeta conocida: no muestra la fila de la tarjeta", async () => {
      const { queryByTestId } = await renderCard(
        due({ route: "near", lastAttempt: "rejected", failureReason: "card_rejected" }),
        ShipmentStatus.ASSIGNMENT_PENDING,
      );
      expect(queryByTestId("funds-status-card")).toBeNull();
    });

    it.each([
      [ShipmentStatus.ASSIGNED, "Fondos reservados", /Se cobra recién cuando Julieta entregue/],
      [ShipmentStatus.IN_TRANSIT, "En camino", /Julieta ya retiró el paquete/],
      [ShipmentStatus.DELIVERED, "Entregado", /Estamos procesando el cobro/],
    ])("reservada en %s: es una reserva, no un cobro (AC7)", async (status, eyebrow, body) => {
      const { getByTestId, getByText, queryByText } = await renderCard(
        { viewer: "sender", phase: "held", amountArs: 18400, card: { brand: "master", lastFour: "1111" } },
        status,
        "Julieta",
      );
      expect(getByTestId("funds-status-held-eyebrow")).toHaveTextContent(eyebrow);
      expect(getByText("Reservaste $18.400")).toBeTruthy();
      expect(getByText(body)).toBeTruthy();
      expect(getByText(/Es una reserva, no un cobro/)).toBeTruthy();
      expect(getByTestId("funds-status-card")).toHaveTextContent("Mastercard •••• 1111");
      expect(queryByText(DEBIT_CLAIM)).toBeNull();
    });

    it("cobrada al entregar: recién acá se dice que se cobró", async () => {
      const { getByText } = await renderCard(
        { viewer: "sender", phase: "captured", amountArs: 18400, at: "2026-10-09T15:00:00.000Z" },
        ShipmentStatus.COMPLETED,
      );
      expect(getByText("Pago cobrado")).toBeTruthy();
      expect(getByText(/ahí se cobró la reserva/)).toBeTruthy();
    });

    it("liberada al cancelar: no se cobró nada", async () => {
      const { getByText } = await renderCard(
        { viewer: "sender", phase: "released", amountArs: 18400 },
        ShipmentStatus.CANCELLED,
      );
      expect(getByText("Se liberó la reserva")).toBeTruthy();
      expect(getByText(/No se cobró nada/)).toBeTruthy();
    });

    it("volvió a publicarse: motivo, sin botón propio a las ofertas (lo da la bandeja de abajo) (AC6)", async () => {
      const { getByText, queryByTestId } = await renderCard(
        { viewer: "sender", phase: "lapsed", reason: "window_expired", at: PAY_UNTIL },
        ShipmentStatus.PUBLISHED,
      );
      expect(getByText("Tu envío volvió a publicarse")).toBeTruthy();
      expect(getByText(/No confirmaste el pago a tiempo/)).toBeTruthy();
      expect(queryByTestId("funds-status-offers")).toBeNull();
    });
  });

  describe("transportista (AC2)", () => {
    it("pago del emisor pendiente: plazo, sin montos ni datos de la tarjeta", async () => {
      const { getByTestId, getByText, queryByText } = await renderCard(
        { viewer: "carrier", phase: "sender_payment_pending", payUntil: PAY_UNTIL },
        ShipmentStatus.ASSIGNED_UNFUNDED,
      );
      expect(getByTestId("funds-status-carrier-pending")).toBeTruthy();
      expect(getByText("Pago del emisor pendiente")).toBeTruthy();
      expect(queryByText(/\$/)).toBeNull();
      expect(queryByText(/••••/)).toBeNull();
    });

    it("fondos reservados", async () => {
      const { getByText, queryByText } = await renderCard({ viewer: "carrier", phase: "held" }, ShipmentStatus.ASSIGNED);
      expect(getByText("El pago del envío ya está reservado")).toBeTruthy();
      expect(queryByText(/\$/)).toBeNull();
    });

    it("envío liberado: por qué y acceso a buscar otros envíos (AC6)", async () => {
      const { getByText, getByTestId } = await renderCard(
        { viewer: "former_carrier", phase: "lapsed", reason: "payment_timeout", at: PAY_UNTIL },
        ShipmentStatus.PUBLISHED,
      );
      expect(getByText("Este envío se liberó")).toBeTruthy();
      expect(getByText(/El pago del emisor no se completó a tiempo/)).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId("funds-status-find-shipments"));
      });
      expect(router.replace).toHaveBeenCalledWith("/(app)/(tabs)/transport");
    });
  });
});
