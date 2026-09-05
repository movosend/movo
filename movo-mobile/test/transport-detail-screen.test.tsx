import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { RouteResult, ShipmentSummary } from "../src/api/shipments-client";
import TransportShipmentDetailScreen from "../app/(app)/transport/[id]";
import { formatTripDistanceKm, haversineDistanceKm } from "../src/lib/shipment-format";

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({ id: "shipment-1" }),
}));

const mockUseShipment = jest.fn();
const mockUseShipmentRoute = jest.fn<{ data: RouteResult | undefined }, []>(() => ({ data: undefined }));
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
  useShipmentPhotos: () => ({ data: [], isLoading: false }),
  useShipmentRoute: () => mockUseShipmentRoute(),
}));

jest.mock("../components/send/route-map-card", () => {
  const { View } = require("react-native");
  return { RouteMapCard: (props: { testID?: string }) => <View testID={props.testID} /> };
});

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (userId: string) => ({
    data: {
      id: userId,
      fullName: "Pedro Emisor",
      photoUrl: null,
      isVerified: true,
      badges: ["kyc_verified"],
      transactionCounts: { asSender: 0, asCarrier: 0 },
      reputationScore: null,
      ratingCount: 0,
      isNewProfile: true,
      asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
      asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true },
      recentRatingComments: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "shipment-1",
    senderId: "user-1",
    receiverId: "receiver-1",
    carrierId: null,
    packageType: "standard_package",
    weightKg: 2,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-08-20",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.PUBLISHED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("TransportShipmentDetailScreen", () => {
  beforeEach(() => mockCanGoBack.mockReturnValue(true));
  afterEach(() => jest.clearAllMocks());

  it("muestra el skeleton mientras el fetch está pendiente", async () => {
    mockUseShipment.mockReturnValue({ isLoading: true, isError: false, data: undefined, error: null, refetch: jest.fn() });

    const { getByTestId, queryByTestId } = await render(<TransportShipmentDetailScreen />);

    expect(getByTestId("transport-detail-skeleton")).toBeTruthy();
    expect(queryByTestId("transport-detail-route-map")).toBeNull();
  });

  it("un 403 se muestra como 'ya no está disponible', no como 'no te pertenece'", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new ApiError(403, "CARRIER_NOT_VERIFIED", "forbidden"),
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText("Este envío ya no está disponible.")).toBeTruthy();
    expect(queryByText("Este envío no te pertenece.")).toBeNull();
  });

  it("un 404 se muestra como 'no existe'", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new ApiError(404, "NOT_FOUND", "not found"),
      refetch: jest.fn(),
    });

    const { getByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText("Este envío no existe.")).toBeTruthy();
  });

  it("muestra tanto Emisor como Receptor, sin el banner de ofertas del emisor", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText, getByTestId, queryByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText("Emisor")).toBeTruthy();
    expect(getByTestId("transport-detail-sender")).toBeTruthy();
    expect(getByText("Receptor")).toBeTruthy();
    expect(getByTestId("transport-detail-receiver")).toBeTruthy();
  });

  // MOVO-154: tocar la card de emisor/receptor abre el perfil público en una sheet.
  // MOVO-176: la sheet chica de MOVO-154 se reemplazó por una pantalla completa.
  it("tocar la card del emisor navega a la pantalla de perfil público", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<TransportShipmentDetailScreen />);

    await fireEvent.press(getByTestId("transport-detail-sender"));
    expect(mockRouterPush).toHaveBeenCalledWith("/profile/user-1");
  });

  it("mientras no hay ruta real, muestra la aproximación en línea recta", async () => {
    const data = shipment();
    const expectedLabel = formatTripDistanceKm(
      haversineDistanceKm(data.pickupLat, data.pickupLng, data.deliveryLat, data.deliveryLng),
    );
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data, error: null, refetch: jest.fn() });
    mockUseShipmentRoute.mockReturnValue({ data: undefined });

    const { getByTestId } = await render(<TransportShipmentDetailScreen />);

    expect(getByTestId("transport-detail-trip-distance").props.children).toBe(`${expectedLabel} de viaje (aprox.)`);
  });

  it("con la ruta real disponible, muestra la distancia real por calle, no la aproximación", async () => {
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data: shipment(), error: null, refetch: jest.fn() });
    mockUseShipmentRoute.mockReturnValue({
      data: { polyline: "encoded", distanceMeters: 12345, durationSeconds: 900 },
    });

    const { getByTestId } = await render(<TransportShipmentDetailScreen />);

    expect(getByTestId("transport-detail-trip-distance").props.children).toBe("12.3 km de viaje");
  });
});
