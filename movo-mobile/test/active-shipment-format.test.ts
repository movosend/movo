import type { ActiveShipmentSummary } from "../src/api/shipments-client";
import {
  activeShipmentCta,
  activeShipmentDisplayCode,
  activeShipmentFooterText,
  activeShipmentInfoText,
  activeShipmentPickupDayLabel,
  activeShipmentPickupWindowLabel,
  activeShipmentStatusLabel,
  activeShipmentStepIndex,
  activeShipmentSubtitle,
  mergeActiveShipments,
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
    pickupWindowExpired: false, tripId: null,
    transitAnomalyFlaggedAt: null,
    ...overrides,
  };
}

describe("activeShipmentCta (MOVO-193 AC5, recortado a sending/receiving)", () => {
  it("emisor + assigned -> Generar retiro", () => {
    const cta = activeShipmentCta("sending", makeShipment({ status: "assigned" }));
    expect(cta).toEqual({
      label: "Generar retiro",
      destination: "MOVO-159 · QR de retiro",
      action: "navigate",
      path: "/(app)/shipments/s1/handshake",
    });
  });

  it("receptor + in_transit -> Confirmar recepción", () => {
    const cta = activeShipmentCta("receiving", makeShipment({ status: "in_transit" }));
    expect(cta).toEqual({
      label: "Confirmar recepción",
      destination: "MOVO-160 · Escaneo de entrega",
      action: "navigate",
      path: "/(app)/shipments/s1/handshake-scan",
    });
  });

  it("emisor + in_transit -> Ver en el mapa, variante secundaria (negra, no lime)", () => {
    const cta = activeShipmentCta("sending", makeShipment({ status: "in_transit" }));
    expect(cta).toEqual({
      action: "live_tracking",
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

  it("con el viaje del transportista en curso, emisor y receptor ven que ya salió a retirar", () => {
    const name = "Lucía Gómez";
    const started = makeShipment({ status: "assigned", tripStarted: true });
    expect(activeShipmentFooterText("sending", started)).toBe(`${name} ya salió a retirar`);
    expect(activeShipmentFooterText("receiving", started)).toBe(`${name} ya salió a retirar`);
    expect(activeShipmentInfoText("receiving", started)).toBe("Ya salió a retirar el paquete.");
    // Una vez retirado manda "en camino", haya o no viaje en curso.
    expect(activeShipmentFooterText("receiving", makeShipment({ status: "in_transit", tripStarted: true }))).toBe(
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
    expect(activeShipmentStatusLabel(makeShipment({ status: "assigned" }))).toBe("Por retirar");
    expect(activeShipmentStatusLabel(makeShipment({ status: "in_transit" }))).toBe("En camino");
  });

  it("MOVO-278: un in_transit marcado como demorado es 'Demorado'; sin marca, 'En camino'", () => {
    expect(
      activeShipmentStatusLabel(
        makeShipment({ status: "in_transit", transitAnomalyFlaggedAt: "2026-10-04T10:00:00.000Z" }),
      ),
    ).toBe("Demorado");
    expect(activeShipmentStatusLabel(makeShipment({ status: "in_transit", transitAnomalyFlaggedAt: null }))).toBe(
      "En camino",
    );
  });

  it("assigned_unfunded (card flat, previa a que arranque el viaje) muestra la hora de retiro, no un texto genérico", () => {
    expect(
      activeShipmentStatusLabel(
        makeShipment({ status: "assigned_unfunded", pickupTimeWindowStart: "09:00:00" }),
      ),
    ).toBe("Retira 09:00 h");
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

describe("activeShipmentPickupWindowLabel", () => {
  it("con la ventana vigente muestra solo la franja", () => {
    expect(activeShipmentPickupWindowLabel(makeShipment({ pickupWindowExpired: false }))).toBe("09:00 a 12:00 h");
  });

  it("con la ventana vencida de otro día antepone el día (TestFlight build 17)", () => {
    expect(
      activeShipmentPickupWindowLabel(
        makeShipment({
          pickupDate: "2026-10-25",
          pickupTimeWindowStart: "21:00",
          pickupTimeWindowEnd: "23:00",
          pickupWindowExpired: true,
          isToday: false,
        }),
      ),
    ).toBe("dom 25/10 · 21:00 a 23:00 h");
  });

  it("con la ventana vencida de hoy no repite el día (el subtítulo ya dice \"hoy\")", () => {
    expect(activeShipmentPickupWindowLabel(makeShipment({ pickupWindowExpired: true, isToday: true }))).toBe(
      "09:00 a 12:00 h",
    );
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

describe("mergeActiveShipments (Envíos en curso: los dos lados juntos, por urgencia)", () => {
  const ship = (id: string, overrides: Partial<ActiveShipmentSummary>): ActiveShipmentSummary =>
    ({
      id,
      status: "assigned",
      pickupDate: "2026-11-20",
      pickupTimeWindowStart: "09:00",
      pickupTimeWindowEnd: "12:00",
      pickupAddress: "Córdoba 1200, Córdoba",
      deliveryAddress: "San Martín 450, Córdoba",
      agreedPriceArs: 4500,
      counterparty: { name: "Lucía Gómez", initials: "LG" },
      isToday: false,
      pickupWindowExpired: false,
      tripId: null,
      transitAnomalyFlaggedAt: null,
      ...overrides,
    }) as ActiveShipmentSummary;

  it("primero lo que pide acción hoy, después lo que pide acción, en camino, asignado y sin pago", () => {
    const sending = [
      ship("send-unfunded", { status: "assigned_unfunded" }),
      ship("send-in-transit", { status: "in_transit" }), // el emisor solo mira el mapa: no pide acción
      ship("send-pickup-later", { status: "assigned", pickupDate: "2026-11-25" }),
      ship("send-pickup-today", { status: "assigned", isToday: true }),
    ];
    const receiving = [
      ship("recv-assigned", { status: "assigned" }), // el receptor no tiene nada que hacer todavía
      ship("recv-confirm", { status: "in_transit" }), // confirmar la entrega
    ];

    expect(mergeActiveShipments(sending, receiving).map(({ shipment, role }) => `${role}:${shipment.id}`)).toEqual([
      "sending:send-pickup-today",
      "receiving:recv-confirm",
      "sending:send-pickup-later",
      "sending:send-in-transit",
      "receiving:recv-assigned",
      "sending:send-unfunded",
    ]);
  });

  it("una ventana de retiro vencida va al principio aunque no sea de hoy", () => {
    const merged = mergeActiveShipments(
      [ship("a", { status: "assigned", isToday: true })],
      [ship("b", { status: "assigned", pickupWindowExpired: true })],
    );
    expect(merged.map(({ shipment }) => shipment.id)).toEqual(["a", "b"]);
    // a igual urgencia (los dos en 0), manda la fecha de retiro y después el orden de llegada
  });
});
