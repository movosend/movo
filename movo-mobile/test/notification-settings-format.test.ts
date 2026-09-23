import {
  activeCategoriesLabel,
  getNotificationCategoryDefinition,
  groupCategoriesBySection,
  isCategoryEnabled,
  quietHoursSummaryLabel,
  triggersForCategory,
} from "../src/lib/notification-settings-format";

describe("notification-settings-format", () => {
  describe("groupCategoriesBySection", () => {
    it("agrupa en el orden fijo sending/carrying/account/conversations", () => {
      const groups = groupCategoriesBySection();

      expect(groups.map((g) => g.section)).toEqual(["sending", "carrying", "account", "conversations"]);
      groups.forEach((g) => expect(g.categories.length).toBeGreaterThan(0));
    });

    it("cada categoría real aparece en su sección declarada", () => {
      const groups = groupCategoriesBySection();
      const sending = groups.find((g) => g.section === "sending")!;
      const carrying = groups.find((g) => g.section === "carrying")!;

      expect(sending.categories.map((c) => c.id)).toEqual(
        expect.arrayContaining(["custody", "offers", "ratings", "shipments"]),
      );
      expect(carrying.categories.map((c) => c.id)).toEqual(expect.arrayContaining(["trips"]));
    });
  });

  describe("getNotificationCategoryDefinition", () => {
    it("devuelve la categoría por id", () => {
      expect(getNotificationCategoryDefinition("custody")?.section).toBe("sending");
    });

    it("undefined para un id desconocido", () => {
      expect(getNotificationCategoryDefinition("no-existe")).toBeUndefined();
    });
  });

  describe("triggersForCategory", () => {
    it("trae los triggers reales de una categoría implementada", () => {
      const triggers = triggersForCategory("custody");

      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers.every((t) => typeof t.title === "string" && typeof t.body === "string")).toBe(true);
    });

    it("array vacío para una categoría 'Pronto' sin trigger real", () => {
      expect(triggersForCategory("kyc")).toEqual([]);
    });
  });

  describe("isCategoryEnabled", () => {
    it("respeta el valor explícito de la fila", () => {
      expect(isCategoryEnabled([{ id: "custody", enabled: false }], "custody")).toBe(false);
    });

    it("ausencia de fila resuelve a habilitado (AC5 del backend)", () => {
      expect(isCategoryEnabled([], "custody")).toBe(true);
    });
  });

  describe("quietHoursSummaryLabel", () => {
    it("Desactivado cuando enabled es false", () => {
      expect(quietHoursSummaryLabel({ enabled: false, from: "23:00", to: "08:00" })).toBe("Desactivado");
    });

    it("De X a Y cuando enabled es true", () => {
      expect(quietHoursSummaryLabel({ enabled: true, from: "23:00", to: "08:00" })).toBe("De 23:00 a 08:00");
    });
  });

  describe("activeCategoriesLabel", () => {
    it("cuenta habilitadas sobre el total", () => {
      const categories = [
        { id: "a", enabled: true },
        { id: "b", enabled: false },
        { id: "c", enabled: true },
      ];
      expect(activeCategoriesLabel(categories)).toBe("2/3 activas");
    });
  });
});
