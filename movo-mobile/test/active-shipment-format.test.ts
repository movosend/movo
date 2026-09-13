import type { ActiveShipmentSummary } from "../src/api/shipments-client";
import {
  activeShipmentCta,
  activeShipmentDisplayCode,
  activeShipmentFooterText,
  activeShipmentInfoText,
  activeShipmentPickupDayLabel,
  activeShipmentStatusLabel,
  activeShipmentStepIndex,
  activeShipmentSubtitle,
} from "../src/lib/active-shipment-format";

function makeShipment(overrides: Partial<ActiveShipmentSummary> = {}): ActiveShipmentSummary {
  return {
    id: "s1",
    status: "assigned",
    pickupDate: "2026-09-15",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Córdoba 1200, Córdoba",
    deliveryAddress: "San Martín 450, Córdoba",
    agreedPriceArs: 4500,
    counterparty: { name: "Lucía Gómez", initials: "LG" },
    isToday: false,
    pickupWindowExpired: false,
    ...overrides,
  };
}

describe("activeShipmentCta (MOVO-193 AC5, recortado a sending/receiving)", () => {
  it("emisor + assigned -> Generar retiro", () => {
    const cta = activeShipmentCta("sending", makeShipment({ status: "assigned" }));
    expect(cta).toEqual({ label: "Generar retiro", destination: "MOVO-159 · QR de retiro" });
  });

  it("receptor + in_transit -> Confirmar recepción", () => {
    const cta = activeShipmentCta("receiving", makeShipment({ status: "in_transit" }));
    expect(cta).toEqual({ label: "Confirmar recepción", destination: "MOVO-160 · Escaneo de entrega" });
  });

  it("emisor + in_transit -> Ver en el mapa, variante secundaria (negra, no lime)", () => {
    const cta = activeShipmentCta("sending", makeShipment({ status: "in_transit" }));
    expect(cta).toEqual({
      label: "Ver en el mapa",
      destination: "MOVO-203/MOVO-11 · Tracking en vivo",
      variant: "secondary",
    });
  });

  it("assigned_unfunded nunca tiene CTA, en ningún rol", () => {
    expect(activeShipmentCta("sending", makeShipment({ status: "assigned_unfunded" }))).toBeNull();
    expect(activeShipmentCta("receiving", makeShipment({ status: "assigned_unfunded" }))).toBeNull();
  });

  it("combinaciones sin acción contextual devuelven null", () => {
    expect(activeShipmentCta("receiving", makeShipment({ status: "assigned" }))).toBeNull();
  });
});

describe("activeShipmentInfoText", () => {
  it("describe assigned_unfunded distinto por rol", () => {
    expect(activeShipmentInfoText("sending", makeShipment({ status: "assigned_unfunded" }))).toMatch(
      /fondos/i,
    );
    expect(activeShipmentInfoText("receiving", makeShipment({ status: "assigned_unfunded" }))).toMatch(
      /fondos/i,
    );
  });

  it("describe los estados sin CTA de cada rol", () => {
    expect(activeShipmentInfoText("sending", makeShipment({ status: "in_transit" }))).toBe(
      "En camino a destino.",
    );
    expect(activeShipmentInfoText("receiving", makeShipment({ status: "assigned" }))).toBe(
      "Todavía no salió a entregar.",
    );
  });
});

describe("activeShipmentFooterText", () => {
  it("usa el texto de fondos pendientes cuando está unfunded, en ambos roles", () => {
    expect(activeShipmentFooterText("sending", makeShipment({ status: "assigned_unfunded" }))).toMatch(
      /fondos/i,
    );
    expect(activeShipmentFooterText("receiving", makeShipment({ status: "assigned_unfunded" }))).toMatch(
      /fondos/i,
    );
  });

  it("nombra a la contraparte según rol y estado", () => {
    const name = "Lucía Gómez";
    expect(activeShipmentFooterText("sending", makeShipment({ status: "assigned" }))).toBe(
      `${name} retira con este código`,
    );
    expect(activeShipmentFooterText("sending", makeShipment({ status: "in_transit" }))).toBe(
      `${name} lo lleva`,
    );
    expect(activeShipmentFooterText("receiving", makeShipment({ status: "assigned" }))).toBe(
      `${name} todavía no salió`,
    );
    expect(activeShipmentFooterText("receiving", makeShipment({ status: "in_transit" }))).toBe(
      `${name} te lo trae`,
    );
  });
});

describe("activeShipmentStepIndex", () => {
  it("assigned_unfunded y assigned se paran en 'Retiro' (índice 0)", () => {
    expect(activeShipmentStepIndex("assigned_unfunded")).toBe(0);
    expect(activeShipmentStepIndex("assigned")).toBe(0);
  });

  it("in_transit avanza a 'En camino' (índice 1), nunca a 'Llegando'", () => {
    expect(activeShipmentStepIndex("in_transit")).toBe(1);
  });
});

describe("activeShipmentDisplayCode", () => {
  it("deriva un código '#MOVO-XXXXX' a partir de los últimos 5 caracteres alfanuméricos del id", () => {
    expect(activeShipmentDisplayCode("550e8400-e29b-41d4-a716-446655440000")).toBe("#MOVO-40000");
  });

  it("es determinístico: el mismo id siempre produce el mismo código", () => {
    const id = "abc123-def456-ghi789";
    expect(activeShipmentDisplayCode(id)).toBe(activeShipmentDisplayCode(id));
  });

  it("nunca busca/identifica contra el backend con esto: distintos ids casi iguales dan códigos distintos", () => {
    expect(activeShipmentDisplayCode("s1")).not.toBe(activeShipmentDisplayCode("s2"));
  });
});

describe("activeShipmentStatusLabel", () => {
  it("traduce los estados sin hora asociada", () => {
    expect(activeShipmentStatusLabel(makeShipment({ status: "assigned" }))).toBe("Asignado");
    expect(activeShipmentStatusLabel(makeShipment({ status: "in_transit" }))).toBe("En camino");
  });

  it("assigned_unfunded (card flat, previa a que arranque el viaje) muestra la hora de retiro, no un texto genérico", () => {
    expect(
      activeShipmentStatusLabel(
        makeShipment({ status: "assigned_unfunded", pickupTimeWindowStart: "09:00:00" }),
      ),
    ).toBe("Retira 09:00");
  });
});

describe("activeShipmentPickupDayLabel", () => {
  const now = new Date(2026, 8, 15); // 15/9/2026

  it("'hoy' viene directo del flag del backend, sin comparar fechas", () => {
    expect(activeShipmentPickupDayLabel(makeShipment({ isToday: true, pickupDate: "2099-01-01" }), now)).toBe(
      "hoy",
    );
  });

  it("'mañana' se resuelve client-side comparando pickupDate contra el día siguiente a `now`", () => {
    expect(activeShipmentPickupDayLabel(makeShipment({ isToday: false, pickupDate: "2026-09-16" }), now)).toBe(
      "mañana",
    );
  });

  it("cualquier otro día no devuelve nada (nunca una frase relativa ambigua)", () => {
    expect(activeShipmentPickupDayLabel(makeShipment({ isToday: false, pickupDate: "2026-09-20" }), now)).toBeNull();
  });
});

describe("activeShipmentSubtitle", () => {
  const now = new Date(2026, 8, 15);

  it("hoy/mañana se agregan al nombre de la contraparte", () => {
    expect(
      activeShipmentSubtitle(makeShipment({ isToday: true, counterparty: { name: "Nicolás Vera", initials: "NV" } }), now),
    ).toBe("Nicolás Vera retira hoy");
    expect(
      activeShipmentSubtitle(
        makeShipment({ isToday: false, pickupDate: "2026-09-16", counterparty: { name: "Nicolás Vera", initials: "NV" } }),
        now,
      ),
    ).toBe("Nicolás Vera retira mañana");
  });

  it("sin hoy/mañana, o ya en camino, muestra solo el nombre", () => {
    expect(
      activeShipmentSubtitle(makeShipment({ isToday: false, pickupDate: "2026-09-20" }), now),
    ).toBe("Lucía Gómez");
    expect(
      activeShipmentSubtitle(makeShipment({ status: "in_transit", isToday: true }), now),
    ).toBe("Lucía Gómez");
  });
});
