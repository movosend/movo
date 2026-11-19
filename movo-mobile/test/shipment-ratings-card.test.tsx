import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import {
  ShipmentRatingsCard,
  isRatingWindowExpired,
  resolveCounterparties,
} from "../components/shipments/shipment-ratings-card";
import type { Rating, RatingEligibility, ShipmentRatingEligibility } from "../src/api/ratings-client";
import { formatFundingDeadline } from "../src/lib/funds-status-format";
import { msUntilNextWindowClose } from "../src/hooks/use-ratings";
import type { ShipmentSummary } from "../src/api/shipments-client";

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (userId: string) => ({
    data: {
      id: userId,
      fullName:
        userId === "carrier-1"
          ? "Marta Conductora"
          : userId === "receiver-1"
            ? "Juan Receptor"
            : "Pedro Emisor",
    },
    isLoading: false,
  }),
}));

const ROLE_BY_ID = { "carrier-1": "carrier", "sender-1": "sender", "receiver-1": "receiver" } as const;

/** La misma elegibilidad para cada contraparte posible (el card busca la suya por `rateeId`). */
function forAll(
  canRate: boolean,
  reason: RatingEligibility["reason"],
  windowEndsAt: string | null = null
): ShipmentRatingEligibility {
  return {
    counterparties: Object.entries(ROLE_BY_ID).map(([rateeId, rateeRole]) => ({
      rateeId,
      rateeRole,
      canRate,
      reason,
      windowEndsAt,
    })),
  };
}

const CAN_RATE = forAll(true, null);

describe("ShipmentRatingsCard", () => {
  const baseShipment: ShipmentSummary = {
    id: "shipment-1",
    senderId: "sender-1",
    receiverId: "receiver-1",
    carrierId: "carrier-1",
    packageType: "standard_package",
    weightKg: 2,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 10,
    description: "Caja",
    urgent: false,
    pickupAddress: "Origen",
    pickupLat: -31.4,
    pickupLng: -64.1,
    deliveryAddress: "Destino",
    deliveryLat: -31.42,
    deliveryLng: -64.18,
    pickupDate: "2026-09-01",
    pickupTimeWindowStart: "10:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 10000,
    highDemand: null,
    agreedPriceArs: 9500,
    paymentMethod: "card",
    status: ShipmentStatus.DELIVERED,
    lastStatusChangedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    deliveredAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };

  const mockRatings: Rating[] = [
    {
      id: "r-1",
      shipmentId: "shipment-1",
      raterId: "sender-1",
      rateeId: "carrier-1",
      role: "carrier",
      score: 5,
      comment: "Marta fue súper puntual",
      createdAt: "2026-09-01T12:30:00.000Z",
    },
  ];

  it("resuelve correctamente las contrapartes según la interacción física", () => {
    // Emisor solo califica al transportista
    const fromSender = resolveCounterparties(baseShipment, "sender-1");
    expect(fromSender).toEqual([
      { userId: "carrier-1", roleLabel: "Transportista", rateeRole: "carrier" },
    ]);

    // Receptor solo califica al transportista
    const fromReceiver = resolveCounterparties(baseShipment, "receiver-1");
    expect(fromReceiver).toEqual([
      { userId: "carrier-1", roleLabel: "Transportista", rateeRole: "carrier" },
    ]);

    // Transportista califica a ambos (emisor y receptor)
    const fromCarrier = resolveCounterparties(baseShipment, "carrier-1");
    expect(fromCarrier).toEqual([
      { userId: "sender-1", roleLabel: "Emisor", rateeRole: "sender" },
      { userId: "receiver-1", roleLabel: "Receptor", rateeRole: "receiver" },
    ]);
  });

  it("calcula expiración de la ventana de 72 horas", () => {
    const recent = new Date(Date.now() - 10 * 3600 * 1000).toISOString(); // 10 horas atrás
    expect(isRatingWindowExpired(recent)).toBe(false);

    const old = new Date(Date.now() - 73 * 3600 * 1000).toISOString(); // 73 horas atrás
    expect(isRatingWindowExpired(old)).toBe(true);
  });

  it("renderiza botones de Calificar y Editar según si ya calificó", async () => {
    const handleRate = jest.fn();

    // Caso 1: transportista califica a emisor (ya calificado) y a receptor (pendiente)
    const carrierRatings: Rating[] = [
      {
        id: "r-2",
        shipmentId: "shipment-1",
        raterId: "carrier-1",
        rateeId: "sender-1",
        role: "sender",
        score: 5,
        comment: "El paquete estaba listo a tiempo",
        createdAt: "2026-09-01T12:30:00.000Z",
      },
    ];

    const { getByTestId, queryByTestId } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="carrier-1"
        ratings={carrierRatings}
        eligibility={CAN_RATE}
        onRate={handleRate}
      />
    );

    // Pedro (sender-1) ya fue calificado: tiene botón Editar
    expect(getByTestId("edit-btn-sender-1")).toBeTruthy();
    expect(queryByTestId("rate-btn-sender-1")).toBeNull();

    // Juan (receiver-1) no fue calificado: tiene botón Calificar
    expect(getByTestId("rate-btn-receiver-1")).toBeTruthy();
    expect(queryByTestId("edit-btn-receiver-1")).toBeNull();

    // Al tocar Editar llama a onRate con la calificación existente
    await fireEvent.press(getByTestId("edit-btn-sender-1"));
    expect(handleRate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "sender-1",
        existingRating: carrierRatings[0],
      })
    );

    // Al tocar Calificar llama a onRate sin existingRating
    await fireEvent.press(getByTestId("rate-btn-receiver-1"));
    expect(handleRate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "receiver-1",
        existingRating: undefined,
      })
    );
  });

  // MOVO-154: tocar avatar/nombre abre el perfil de la contraparte — acción distinta
  // de calificar, no debe compartir handler con el botón Calificar/Editar.
  it("tocar avatar/nombre llama a onViewProfile, no a onRate", async () => {
    const handleRate = jest.fn();
    const handleViewProfile = jest.fn();

    const { getByTestId } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="carrier-1"
        ratings={[]}
        eligibility={CAN_RATE}
        onRate={handleRate}
        onViewProfile={handleViewProfile}
      />
    );

    await fireEvent.press(getByTestId("rating-row-profile-sender-1"));

    expect(handleViewProfile).toHaveBeenCalledWith("sender-1");
    expect(handleRate).not.toHaveBeenCalled();
  });

  it("sin `onViewProfile`, el bloque de avatar/nombre no es tocable", async () => {
    const handleRate = jest.fn();

    const { getByTestId } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="carrier-1"
        ratings={[]}
        eligibility={CAN_RATE}
        onRate={handleRate}
      />
    );

    expect(getByTestId("rating-row-profile-sender-1").props.accessibilityRole).toBeUndefined();
  });

  it("muestra advertencia cuando el backend dice que el envío está en disputa", async () => {
    const disputedShipment: ShipmentSummary = {
      ...baseShipment,
      status: ShipmentStatus.DISPUTED,
    };

    const { getByText, queryByTestId } = await render(
      <ShipmentRatingsCard
        shipment={disputedShipment}
        currentUserId="sender-1"
        ratings={[]}
        eligibility={forAll(false, "dispute_active")}
        onRate={jest.fn()}
      />
    );

    expect(
      getByText("Vas a poder calificar cuando se resuelva la disputa")
    ).toBeTruthy();
    expect(queryByTestId("rate-btn-carrier-1")).toBeNull();
  });

  it("muestra texto de plazo vencido cuando pasaron más de 72 horas", async () => {
    const expiredShipment: ShipmentSummary = {
      ...baseShipment,
      deliveredAt: new Date(Date.now() - 80 * 3600 * 1000).toISOString(),
    };

    const { getByText, queryByTestId } = await render(
      <ShipmentRatingsCard
        shipment={expiredShipment}
        currentUserId="sender-1"
        ratings={[]}
        eligibility={forAll(false, "window_expired")}
        onRate={jest.fn()}
      />
    );

    expect(
      getByText("El plazo de 72 horas para calificar terminó")
    ).toBeTruthy();
    expect(queryByTestId("rate-btn-carrier-1")).toBeNull();
  });
  // TestFlight build 19: el receptor veía "Calificar" tras una disputa resuelta y el backend respondía 403.
  it("tras una disputa resuelta que no ganó, no ofrece calificar y dice por qué", async () => {
    const { getByText, queryByTestId } = await render(
      <ShipmentRatingsCard
        shipment={{ ...baseShipment, status: ShipmentStatus.COMPLETED }}
        currentUserId="receiver-1"
        ratings={[]}
        eligibility={forAll(false, "dispute_lost")}
        onRate={jest.fn()}
      />
    );

    expect(getByText("Este envío tuvo una disputa: solo califica quien la ganó")).toBeTruthy();
    expect(queryByTestId("rate-btn-carrier-1")).toBeNull();
  });

  it("tampoco deja editar una calificación ya hecha si el backend no lo permite", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="sender-1"
        ratings={mockRatings}
        eligibility={forAll(false, "dispute_lost")}
        onRate={jest.fn()}
      />
    );

    expect(getByTestId("rating-row-carrier-1")).toBeTruthy();
    expect(queryByTestId("edit-btn-carrier-1")).toBeNull();
  });

  it("mientras no llega la elegibilidad no ofrece calificar", async () => {
    const { queryByTestId } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="receiver-1"
        ratings={[]}
        eligibility={undefined}
        onRate={jest.fn()}
      />
    );

    expect(queryByTestId("rate-btn-carrier-1")).toBeNull();
  });

  it("si el backend no tiene el endpoint (404), vuelve al cálculo local", async () => {
    const { getByTestId } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="receiver-1"
        ratings={[]}
        eligibility={undefined}
        eligibilityError={new ApiError(404, "NOT_FOUND", "Not Found")}
        onRate={jest.fn()}
      />
    );

    expect(getByTestId("rate-btn-carrier-1")).toBeTruthy();
  });

  // Review PR #345: el cálculo local ante un timeout o un 5xx le volvía a ofrecer calificar al receptor tras una
  // disputa resuelta (el 403 de TestFlight).
  it.each([
    ["un 5xx", new ApiError(503, "INTERNAL_ERROR", "Servicio no disponible")],
    ["un corte de red", new TypeError("Network request failed")],
  ])("ante %s no ofrece calificar", async (_label, error) => {
    const { queryByTestId } = await render(
      <ShipmentRatingsCard
        shipment={{ ...baseShipment, status: ShipmentStatus.COMPLETED }}
        currentUserId="receiver-1"
        ratings={[]}
        eligibility={undefined}
        eligibilityError={error}
        onRate={jest.fn()}
      />
    );

    expect(queryByTestId("rate-btn-carrier-1")).toBeNull();
  });

  it("dice hasta cuándo se puede calificar con el cierre que da el backend, no desde la entrega", async () => {
    const windowEndsAt = new Date(Date.now() + 50 * 3600 * 1000).toISOString();
    const { getByText, queryByText } = await render(
      <ShipmentRatingsCard
        shipment={{ ...baseShipment, status: ShipmentStatus.CANCELLED }}
        currentUserId="sender-1"
        ratings={[]}
        eligibility={forAll(true, null, windowEndsAt)}
        onRate={jest.fn()}
      />
    );

    expect(getByText(`Podés calificar hasta ${formatFundingDeadline(windowEndsAt)}`)).toBeTruthy();
    expect(queryByText("Tenés 72 hs desde la entrega para enviar tu opinión")).toBeNull();
  });

  it("aplica a cada fila la elegibilidad de su contraparte", async () => {
    const { getByTestId, queryByTestId, getByText } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="carrier-1"
        ratings={[]}
        eligibility={{
          counterparties: [
            { rateeId: "sender-1", rateeRole: "sender", canRate: true, reason: null, windowEndsAt: null },
            { rateeId: "receiver-1", rateeRole: "receiver", canRate: false, reason: "window_expired", windowEndsAt: null },
          ],
        }}
        onRate={jest.fn()}
      />
    );

    expect(getByTestId("rate-btn-sender-1")).toBeTruthy();
    expect(queryByTestId("rate-btn-receiver-1")).toBeNull();
    expect(getByText("El plazo de 72 horas para calificar terminó")).toBeTruthy();
  });

  it("en un cancelado sin nada para calificar no muestra la sección ni su encabezado", async () => {
    const { queryByTestId, queryByText } = await render(
      <ShipmentRatingsCard
        shipment={{ ...baseShipment, status: ShipmentStatus.CANCELLED }}
        currentUserId="carrier-1"
        ratings={[]}
        eligibility={forAll(false, "not_delivered")}
        onRate={jest.fn()}
        header={<Text>Calificaciones</Text>}
      />
    );

    expect(queryByTestId("shipment-ratings-card")).toBeNull();
    expect(queryByText("Calificaciones")).toBeNull();
  });
});

describe("msUntilNextWindowClose", () => {
  const NOW = Date.parse("2030-01-05T00:00:00.000Z");

  it("vuelve a consultar al cierre más próximo de una ventana abierta", () => {
    const eligibility: ShipmentRatingEligibility = {
      counterparties: [
        { rateeId: "a", rateeRole: "sender", canRate: true, reason: null, windowEndsAt: "2030-01-05T02:00:00.000Z" },
        { rateeId: "b", rateeRole: "receiver", canRate: true, reason: null, windowEndsAt: "2030-01-05T01:00:00.000Z" },
      ],
    };
    expect(msUntilNextWindowClose(eligibility, NOW)).toBe(3600 * 1000 + 1000);
  });

  it("sin ventanas abiertas no repite la consulta", () => {
    expect(msUntilNextWindowClose(undefined, NOW)).toBe(false);
    expect(msUntilNextWindowClose(forAll(false, "window_expired"), NOW)).toBe(false);
  });
});
