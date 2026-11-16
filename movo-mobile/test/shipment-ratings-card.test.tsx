import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import {
  ShipmentRatingsCard,
  isRatingWindowExpired,
  resolveCounterparties,
} from "../components/shipments/shipment-ratings-card";
import type { Rating } from "../src/api/ratings-client";
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

const CAN_RATE = { canRate: true, reason: null } as const;

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
        eligibility={{ canRate: false, reason: "dispute_active" }}
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
        eligibility={{ canRate: false, reason: "window_expired" }}
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
        eligibility={{ canRate: false, reason: "dispute_lost" }}
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
        eligibility={{ canRate: false, reason: "dispute_lost" }}
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

  it("si la consulta de elegibilidad falla, vuelve al cálculo local", async () => {
    const { getByTestId } = await render(
      <ShipmentRatingsCard
        shipment={baseShipment}
        currentUserId="receiver-1"
        ratings={[]}
        eligibility={undefined}
        isEligibilityError
        onRate={jest.fn()}
      />
    );

    expect(getByTestId("rate-btn-carrier-1")).toBeTruthy();
  });
});
