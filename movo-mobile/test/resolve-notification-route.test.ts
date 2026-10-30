jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useRootNavigationState: jest.fn() }));
jest.mock("../src/store/auth-store", () => ({ useAuthStore: jest.fn() }));
jest.mock("../src/lib/push-registration", () => ({ requestPermissionAndRegisterPushToken: jest.fn() }));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
}));

import { resolveNotificationRoute } from "../src/hooks/use-push-notifications";

describe("resolveNotificationRoute (MOVO-281)", () => {
  it.each([
    "shipment",
    "shipment_accepted",
    "shipment_cancelled",
    "offer_accepted",
    "rating_received",
    "rating_pending",
    "receiver_transfer",
    "custody_pickup_confirmed",
    "custody_delivery_confirmed",
    "trip_started",
    "carrier_nearby",
    "dispute_opened",
  ])("%s abre el detalle del envío", (type) => {
    expect(resolveNotificationRoute({ type, shipmentId: "shp_1" })).toBe("/shipments/shp_1");
  });

  it("shipment_rejected abre la elección de otro receptor", () => {
    expect(resolveNotificationRoute({ type: "shipment_rejected", shipmentId: "shp_1" })).toBe(
      "/shipments/shp_1/change-receiver",
    );
  });

  it("offer_created abre las ofertas del envío", () => {
    expect(resolveNotificationRoute({ type: "offer_created", shipmentId: "shp_1", offerId: "off_1" })).toBe(
      "/shipments/shp_1/offers",
    );
  });

  it("MOVO-314 AC4: la push del republicado al emisor (type shipment) abre el envío", () => {
    expect(resolveNotificationRoute({ type: "shipment", shipmentId: "shp_1" })).toBe("/shipments/shp_1");
  });

  it("MOVO-37: la comisión de un envío en efectivo abre la cuenta corriente", () => {
    expect(resolveNotificationRoute({ type: "cash_commission", shipmentId: "shp_1" })).toEqual({
      pathname: "/profile/payments",
      params: { tab: "balance" },
    });
  });

  it.each(["offer_superseded", "offer_rejected", "offer_voided"])(
    "%s abre el detalle de la oferta, no el del envío",
    (type) => {
      expect(resolveNotificationRoute({ type, shipmentId: "shp_1", offerId: "off_1" })).toBe(
        "/carrier/offers/off_1",
      );
    },
  );

  it.each(["offer_superseded", "offer_rejected", "offer_voided"])(
    "%s sin offerId abre Mis ofertas",
    (type) => {
      expect(resolveNotificationRoute({ type, shipmentId: "shp_1" })).toBe("/carrier/offers");
    },
  );

  it("receiver_transfer_invite abre la invitación", () => {
    expect(resolveNotificationRoute({ type: "receiver_transfer_invite", transferId: "tr_1" })).toBe(
      "/receiver-transfers/tr_1",
    );
  });

  it.each(["trip_auto_created", "trip_recurrence_generated", "trip_recurrence_stopped", "trip_recurrence_blocked"])(
    "%s abre el detalle del viaje",
    (type) => {
      expect(resolveNotificationRoute({ type, tripId: "trip_1" })).toBe("/carrier/trips/trip_1");
    },
  );

  it.each(["trip_match", "trip_reminder"])("%s abre el feed filtrado por el viaje", (type) => {
    expect(resolveNotificationRoute({ type, tripId: "trip_1" })).toEqual({
      pathname: "/(app)/(tabs)/transport",
      params: { tripId: "trip_1" },
    });
  });

  it.each(["account_password_changed", "account_email_changed", "account_phone_changed"])(
    "%s abre Cuenta y seguridad",
    (type) => {
      expect(resolveNotificationRoute({ type })).toBe("/profile/security");
    },
  );

  describe("kyc_result", () => {
    it.each([
      ["identity", "approved", "/home"],
      ["license", "approved", "/(app)/(tabs)/transport"],
      ["identity", "manual_review", "/home"],
      ["license", "manual_review", "/home"],
      ["identity", "rejected", "/kyc"],
    ])("%s %s → %s", (verificationType, status, route) => {
      expect(resolveNotificationRoute({ type: "kyc_result", verificationType, status })).toBe(route);
    });

    it("licencia rechazada abre la verificación de licencia con el estado", () => {
      expect(resolveNotificationRoute({ type: "kyc_result", verificationType: "license", status: "rejected" })).toEqual({
        pathname: "/license-kyc",
        params: { status: "rejected" },
      });
    });

    it.each([
      [{ verificationType: "selfie", status: "approved" }],
      [{ verificationType: "identity", status: "pending" }],
      [{ verificationType: "identity" }],
    ])("un kyc_result inválido no navega (%o)", (fields) => {
      expect(resolveNotificationRoute({ type: "kyc_result", ...fields })).toBeNull();
    });
  });

  it.each([
    [{ type: "shipment_cancelled" }],
    [{ type: "shipment_rejected" }],
    [{ type: "offer_created" }],
    [{ type: "trip_auto_created" }],
    [{ type: "trip_recurrence_generated" }],
    [{ type: "trip_reminder" }],
    [{ type: "carrier_nearby", shipmentId: "" }],
  ])("sin el id que necesita la ruta no navega (%o)", (data) => {
    expect(resolveNotificationRoute(data)).toBeNull();
  });

  it.each([[{ type: "algo_nuevo", shipmentId: "shp_1" }], [{}], [null], ["shipment"], [undefined]])(
    "un data desconocido o inválido no navega (%o)",
    (data) => {
      expect(resolveNotificationRoute(data)).toBeNull();
    },
  );

  // MOVO-300 AC6: avisos de sanción de cuenta.
  it("account_suspended abre el detalle de la suspensión", () => {
    expect(resolveNotificationRoute({ type: "account_suspended" })).toBe("/account-status");
  });

  it.each(["account_sanction_lifted", "account_suspension_expired"])("%s abre el inicio", (type) => {
    expect(resolveNotificationRoute({ type })).toBe("/home");
  });

  it("account_disabled abre la pantalla de cuenta inhabilitada", () => {
    expect(resolveNotificationRoute({ type: "account_disabled" })).toBe("/account-disabled");
  });
});
