import { describe, expect, it } from "vitest";
import { getNotificationCategory } from "../src/config/notification-categories";
import { notificationTriggerCategory, renderNotificationTrigger } from "../src/config/notification-templates";

describe("tripDepartureReminder (MOVO-240)", () => {
  it("con paquetes, invita a sumar uno más", () => {
    expect(renderNotificationTrigger("tripDepartureReminder", { destinationShort: "Rosario", packagesCount: 1 })).toEqual({
      title: "Mañana salís de viaje",
      body: "Ya llevás 1 paquete a Rosario. ¿Te entra uno más? Fijate qué envíos te quedan de paso.",
    });
    expect(
      renderNotificationTrigger("tripDepartureReminder", { destinationShort: "Rosario", packagesCount: 3 }).body
    ).toContain("Ya llevás 3 paquetes a Rosario.");
  });

  it("sin paquetes, invita a buscar", () => {
    expect(renderNotificationTrigger("tripDepartureReminder", { destinationShort: "Rosario", packagesCount: 0 })).toEqual({
      title: "Tu viaje es mañana",
      body: "Todavía no tenés paquetes para llevar a Rosario. Entrá y mirá qué envíos te quedan de paso.",
    });
  });
});

describe("avisos de proximidad (MOVO-240)", () => {
  it("van en la categoría proximity, implementada y exenta del horario de silencio", () => {
    expect(notificationTriggerCategory("carrierNearPickup")).toBe("proximity");
    expect(notificationTriggerCategory("carrierNearDelivery")).toBe("proximity");
    expect(getNotificationCategory("proximity")).toMatchObject({ implemented: true, quietHoursExempt: true });
  });
});

describe("settlementDelayedCarrier (MOVO-213)", () => {
  it("avisa que el cobro está en revisión y en cuánto se resuelve", () => {
    const rendered = renderNotificationTrigger("settlementDelayedCarrier", { reviewHours: 48 });
    expect(rendered.title).toBe("Tu cobro está demorado");
    expect(rendered.body).toContain("plazo de hasta 48 horas");
    expect(renderNotificationTrigger("settlementDelayedCarrier", { reviewHours: 1 }).body).toContain("hasta 1 hora.");
  });

  it("va en la categoría de pagos", () => {
    expect(notificationTriggerCategory("settlementDelayedCarrier")).toBe("payments");
  });
});
