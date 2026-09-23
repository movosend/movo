
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { act, fireEvent, render } from "@testing-library/react-native";
import type { RouteResult, ShipmentSummary } from "../src/api/shipments-client";
import TransportShipmentDetailScreen from "../app/(app)/transport/[id]";
import { formatTripDistanceKm, haversineDistanceKm } from "../src/lib/shipment-format";

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn();
const mockUseLocalSearchParams = jest.fn<
  { id: string; pickupDistanceKm?: string },
  []
>(() => ({ id: "shipment-1" }));

jest.mock("expo-router", () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const mockUseShipment = jest.fn();
const mockUseShipmentRoute = jest.fn<{ data: RouteResult | undefined }, []>(() => ({ data: undefined }));
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
  useShipmentPhotos: () => ({ data: [], isLoading: false }),
  useShipmentRoute: () => mockUseShipmentRoute(),
}));

const mockUseMyOffers = jest.fn();
jest.mock("../src/hooks/use-offers", () => ({
  useMyOffers: (params?: { status?: string }) => mockUseMyOffers(params),
}));

/**
 * El componente hace dos llamadas a `useMyOffers`, una por `status` (fix de review,
 * PR #164 -- ver `app/(app)/transport/[id].tsx`) -- este helper reproduce ese
 * filtro server-side sobre un único array de fixtures, así los tests siguen
 * describiendo "las ofertas que existen" en vez de "qué devuelve cada llamada".
 */
function mockMyOffers(items: Array<{ status?: string; [key: string]: unknown }>) {
  mockUseMyOffers.mockImplementation((params: { status?: string } = {}) => ({
    data: { items: params.status ? items.filter((offer) => offer.status === params.status) : items },
  }));
}

const mockCurrentUser = jest.fn(() => ({ userId: "carrier-me" }));
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: { user: { userId: string } | null }) => unknown) => {
    const state = { user: mockCurrentUser() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

jest.mock("../components/send/route-map-card", () => {
  const { View } = require("react-native");
  return { RouteMapCard: (props: { testID?: string }) => <View testID={props.testID} /> };
});

interface MockPublicProfileResult {
  data: {
    id: string;
    fullName: string;
    photoUrl: string | null;
    isVerified: boolean;
    badges: string[];
    transactionCounts: { asSender: number; asCarrier: number };
    reputationScore: number | null;
    ratingCount: number;
    isNewProfile: boolean;
    asSender: { reputationScore: number | null; ratingCount: number; isNewProfile: boolean };
    asCarrier: { reputationScore: number | null; ratingCount: number; isNewProfile: boolean };
    recentRatingComments: unknown[];
  };
  isLoading: boolean;
  isError: boolean;
}

function defaultPublicProfileImpl(userId: string): MockPublicProfileResult {
  return {
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
  };
}
const mockUsePublicProfile = jest.fn(defaultPublicProfileImpl);
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (userId: string) => mockUsePublicProfile(userId),
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
  beforeEach(() => {
    mockCanGoBack.mockReturnValue(true);
    mockMyOffers([]);
  });
  afterEach(() => {
    jest.clearAllMocks();
    // `clearAllMocks` no deshace un `.mockImplementation` seteado a mano (solo limpia
    // calls/instances/results) -- sin esto, el override de un test con múltiples
    // perfiles distintos (ver el test de "Con quién tratás") quedaría pisando el
    // default para todos los tests que corren después en este archivo.
    mockUsePublicProfile.mockImplementation(defaultPublicProfileImpl);
  });

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

  it("muestra la card única 'Con quién tratás' con emisor y receptor, sin el banner de ofertas del emisor", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText, getByTestId, queryByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText("Con quién tratás")).toBeTruthy();
    expect(getByTestId("transport-detail-sender")).toBeTruthy();
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

    expect(getByTestId("transport-detail-trip-distance").props.children).toBe(
      "12.3 km · 15 min de viaje",
    );
  });

  it("con ruta larga (>60 min), muestra la duración en horas y minutos", async () => {
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data: shipment(), error: null, refetch: jest.fn() });
    mockUseShipmentRoute.mockReturnValue({
      data: { polyline: "encoded", distanceMeters: 120000, durationSeconds: 5400 },
    });

    const { getByTestId } = await render(<TransportShipmentDetailScreen />);

    expect(getByTestId("transport-detail-trip-distance").props.children).toBe(
      "120.0 km · 1 h 30 min de viaje",
    );
  });

  it("sin pickupDistanceKm en los params (deep link sin origen), no muestra el badge de distancia al retiro", async () => {
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data: shipment(), error: null, refetch: jest.fn() });

    const { queryByTestId } = await render(<TransportShipmentDetailScreen />);

    expect(queryByTestId("transport-detail-pickup-distance")).toBeNull();
  });

  it("con pickupDistanceKm en los params (venido de la card del listado), muestra el badge de distancia al retiro", async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: "shipment-1", pickupDistanceKm: "1.8" });
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data: shipment(), error: null, refetch: jest.fn() });

    const { getByTestId } = await render(<TransportShipmentDetailScreen />);

    expect(getByTestId("transport-detail-pickup-distance").props.children).toBe(
      "Retiro a 1.8 km de vos",
    );
  });

  it("MOVO-177 (fix de negocio): 'Te queda si ofertás el sugerido' convierte bruto→neto, no muestra el bruto crudo", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      // suggestedPriceArs (4500) es BRUTO -- el neto real si se oferta a ese precio
      // es 4500 / 1.15 = 3913,04, nunca 4500 tal cual (ese fue el bug).
      data: shipment({ suggestedPriceArs: 4500 }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<TransportShipmentDetailScreen />);

    // El bruto (4500) sigue apareciendo como referencia ("Sobre una oferta de
    // $4.500") -- lo que no puede pasar es que ESE número aparezca como "Te queda".
    expect(getByText("$3.913,04")).toBeTruthy();
    expect(getByText("$4.500")).toBeTruthy();
  });

  it("MOVO-180: la card de precio sugerido muestra el conteo/mínimo real de ofertas cuando existen", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ offersSummary: { count: 3, minPriceNetArs: 1900 } }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText("3 · desde $1.900")).toBeTruthy();
  });

  it("MOVO-180: sin ofertas todavía, la subcard muestra un estado vacío en vez de inventar un número", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ offersSummary: null }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText("Sin ofertas todavía")).toBeTruthy();
  });

  it("MOVO-177 (feedback de UI): la sección Recorrido muestra retiro y entrega con dirección, zona y horario", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({
        pickupAddress: "Paul Dirac 7777, Argüello, Córdoba",
        deliveryAddress: "Las Mulitas 7565, Villa Belgrano, Córdoba",
      }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText("Paul Dirac 7777")).toBeTruthy();
    expect(getByText("Argüello")).toBeTruthy();
    expect(getByText("Las Mulitas 7565")).toBeTruthy();
    expect(getByText("Villa Belgrano")).toBeTruthy();
    expect(getByText("Sin horario fijo · lo definís vos en la oferta")).toBeTruthy();
  });

  it("MOVO-177 (feedback de UI): 'Con quién tratás' muestra rol, identidad verificada + reputación, y el estado de confirmación del receptor", async () => {
    mockUsePublicProfile.mockImplementation((userId: string): MockPublicProfileResult => ({
      data: {
        id: userId,
        fullName: userId === "user-1" ? "Pedro Yorlano" : "Lolo Yorlano",
        photoUrl: null,
        isVerified: userId === "user-1",
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: userId === "user-1" ? 4.9 : null,
        ratingCount: userId === "user-1" ? 34 : 0,
        isNewProfile: false,
        asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
        asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true },
        recentRatingComments: [],
      },
      isLoading: false,
      isError: false,
    }));
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.PUBLISHED }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<TransportShipmentDetailScreen />);

    expect(getByText(/Pedro Yorlano/)).toBeTruthy();
    expect(getByText("· emisor")).toBeTruthy();
    expect(getByText("Identidad verificada · 4,9 en 34 envíos")).toBeTruthy();
    expect(getByText(/Lolo Yorlano/)).toBeTruthy();
    expect(getByText("· recibe")).toBeTruthy();
    // `PUBLISHED` implica que el receptor ya confirmó (esa es la transición que lo
    // publica) -- `receiverConfirmationStatus` mapea a "confirmed" acá.
    expect(getByText("Ya aceptó recibir el paquete")).toBeTruthy();
  });

  describe("Acción de ofertar y retirar oferta (MOVO-149)", () => {
    it("sin oferta activa previa, muestra el botón 'Hacer una oferta' y al tocarlo navega a la pantalla de creación", async () => {
      mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data: shipment(), error: null, refetch: jest.fn() });
      mockMyOffers([]);

      const { getByTestId, queryByTestId } = await render(<TransportShipmentDetailScreen />);

      const createCta = getByTestId("transport-create-offer-cta");
      expect(createCta).toHaveTextContent("Hacer una oferta");
      expect(queryByTestId("transport-active-offer-card")).toBeNull();
      expect(queryByTestId("transport-withdraw-offer-cta")).toBeNull();

      await act(async () => {
        fireEvent.press(createCta);
      });

      expect(mockRouterPush).toHaveBeenCalledWith("/(app)/transport/shipment-1/offer");
    });

    it("si ya me asignaron este envío (mi oferta fue aceptada), oculta 'Hacer una oferta' y 'Te queda si ofertás el sugerido', y muestra 'Te eligieron para este envío'", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "carrier-me", status: ShipmentStatus.ASSIGNMENT_PENDING, suggestedPriceArs: 4500 }),
        error: null,
        refetch: jest.fn(),
      });
      // La oferta ya pasó a `accepted` -- deja de aparecer entre las `pending` de
      // `myOffers` (mismo comportamiento real de `useMyOffers`).
      mockMyOffers([]);

      const { getByTestId, queryByTestId, queryByText } = await render(<TransportShipmentDetailScreen />);

      expect(queryByTestId("transport-create-offer-cta")).toBeNull();
      expect(queryByTestId("transport-active-offer-card")).toBeNull();
      expect(queryByText("Te queda si ofertás el sugerido")).toBeNull();
      expect(getByTestId("transport-assigned-to-me-card")).toHaveTextContent(/Te eligieron para este envío/);
      // Sin pill de estado genérico ("Sin asignar" de `assignment_pending`, pensado
      // para el punto de vista del emisor -- confundía acá, donde el envío YA está
      // asignado a mí). En su lugar, el próximo paso concreto con la fecha/franja
      // pedida por el emisor (sin oferta -- ni pending ni accepted -- con día
      // alternativo en este caso).
      expect(queryByText(/Sin asignar/)).toBeNull();
      expect(getByTestId("transport-assigned-to-me-detail")).toHaveTextContent(
        "El viaje arranca el jue, 20 de agosto, entre las 09:00 y las 12:00 h. Ese día retirás el paquete y arrancás el viaje hasta la entrega.",
      );
    });

    it("asignado a mí en `assigned`, 'Iniciar retiro' abre el wizard de retiro", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "carrier-me", status: ShipmentStatus.ASSIGNED }),
        error: null,
        refetch: jest.fn(),
      });
      mockMyOffers([]);

      const { getByTestId, queryByTestId } = await render(<TransportShipmentDetailScreen />);

      expect(queryByTestId("transport-delivery-cta-disabled")).toBeNull();
      await fireEvent.press(getByTestId("transport-pickup-wizard-cta"));
      expect(mockRouterPush).toHaveBeenCalledWith("/(app)/shipments/shipment-1/pickup");
    });

    it("asignado a mí en `in_transit`, la entrega se muestra deshabilitada (sin wizard todavía)", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "carrier-me", status: ShipmentStatus.IN_TRANSIT }),
        error: null,
        refetch: jest.fn(),
      });
      mockMyOffers([]);

      const { getByTestId, queryByTestId } = await render(<TransportShipmentDetailScreen />);

      expect(queryByTestId("transport-pickup-wizard-cta")).toBeNull();
      expect(getByTestId("transport-delivery-cta-disabled")).toBeTruthy();
    });

    it("si me asignaron el envío y mi oferta ganadora propuso otro día/horario, el detalle muestra lo confirmado por la oferta, no lo pedido por el emisor", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        // El envío pide 2026-08-20 09:00-12:00 (default de `shipment()`).
        data: shipment({ carrierId: "carrier-me", status: ShipmentStatus.ASSIGNMENT_PENDING }),
        error: null,
        refetch: jest.fn(),
      });
      mockMyOffers([
        {
          id: "offer-accepted-1",
          shipmentId: "shipment-1",
          carrierId: "carrier-me",
          priceOffered: 7500,
          offeredDate: "2026-08-21",
          offeredPickupTimeWindowStart: "15:00",
          offeredPickupTimeWindowEnd: "19:00",
          message: null,
          status: OfferStatus.ACCEPTED,
        },
      ]);

      const { getByTestId } = await render(<TransportShipmentDetailScreen />);

      expect(getByTestId("transport-assigned-to-me-detail")).toHaveTextContent(
        "El viaje arranca el vie, 21 de agosto, entre las 15:00 y las 19:00 h. Ese día retirás el paquete y arrancás el viaje hasta la entrega.",
      );
    });

    it("si el envío se asignó a OTRO transportista, sigue mostrando el CTA de ofertar normal (no soy yo)", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "otro-transportista", status: ShipmentStatus.ASSIGNMENT_PENDING }),
        error: null,
        refetch: jest.fn(),
      });
      mockMyOffers([]);

      const { queryByTestId } = await render(<TransportShipmentDetailScreen />);

      expect(queryByTestId("transport-assigned-to-me-card")).toBeNull();
      expect(queryByTestId("transport-create-offer-cta")).toBeTruthy();
    });

    it("si ya tiene una oferta activa, muestra la card con sus datos y navega al detalle de la oferta (MOVO-182)", async () => {
      mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data: shipment(), error: null, refetch: jest.fn() });
      mockMyOffers([
        {
          id: "offer-active-1",
          shipmentId: "shipment-1",
          carrierId: "carrier-1",
          priceOffered: 7500,
          offeredDate: "2026-08-20",
          message: "Llego puntual en camioneta",
          status: OfferStatus.PENDING,
        },
      ]);

      const { getByTestId, queryByTestId } = await render(<TransportShipmentDetailScreen />);

      // Sin barra inferior duplicada: la card "Tu oferta activa" es el único punto
      // de entrada al detalle de la oferta.
      expect(queryByTestId("transport-create-offer-cta")).toBeNull();
      expect(queryByTestId("transport-view-offer-cta")).toBeNull();
      expect(getByTestId("transport-active-offer-card")).toBeTruthy();
      expect(getByTestId("transport-active-offer-price")).toHaveTextContent("$7.500");

      await act(async () => {
        fireEvent.press(getByTestId("transport-active-offer-card"));
      });
      expect(mockRouterPush).toHaveBeenCalledWith("/(app)/carrier/offers/offer-active-1");
    });

    it("con una oferta activa, oculta la card 'Te queda si ofertás el sugerido' -- ya no tiene sentido con una oferta propia hecha", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ suggestedPriceArs: 4500 }),
        error: null,
        refetch: jest.fn(),
      });
      mockMyOffers([
        {
          id: "offer-active-1",
          shipmentId: "shipment-1",
          carrierId: "carrier-1",
          priceOffered: 7500,
          offeredDate: "2026-08-20",
          message: null,
          status: OfferStatus.PENDING,
        },
      ]);

      const { getByTestId, queryByText } = await render(<TransportShipmentDetailScreen />);

      expect(getByTestId("transport-active-offer-card")).toBeTruthy();
      expect(queryByText("Te queda si ofertás el sugerido")).toBeNull();
    });

    it("con una oferta activa que propuso otro día/horario, 'Retirás' muestra lo confirmado en la oferta, no lo pedido por el emisor", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        // El envío pide 2026-08-20 09:00-12:00 (default de `shipment()`).
        data: shipment(),
        error: null,
        refetch: jest.fn(),
      });
      mockMyOffers([
        {
          id: "offer-active-1",
          shipmentId: "shipment-1",
          carrierId: "carrier-1",
          priceOffered: 7500,
          // La oferta propuso otro día y franja.
          offeredDate: "2026-08-21",
          offeredPickupTimeWindowStart: "15:00",
          offeredPickupTimeWindowEnd: "19:00",
          message: null,
          status: OfferStatus.PENDING,
        },
      ]);

      const { getByText, queryByText } = await render(<TransportShipmentDetailScreen />);

      expect(getByText(/15:00–19:00/)).toBeTruthy();
      // No debería quedar dando vueltas el horario original del envío.
      expect(queryByText(/09:00–12:00/)).toBeNull();
    });

    it("con una oferta activa que aceptó la franja del emisor tal cual (sin franja propia), 'Retirás' cae al horario del envío", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment(),
        error: null,
        refetch: jest.fn(),
      });
      mockMyOffers([
        {
          id: "offer-active-1",
          shipmentId: "shipment-1",
          carrierId: "carrier-1",
          priceOffered: 7500,
          offeredDate: "2026-08-20",
          offeredPickupTimeWindowStart: null,
          offeredPickupTimeWindowEnd: null,
          message: null,
          status: OfferStatus.PENDING,
        },
      ]);

      const { getByText } = await render(<TransportShipmentDetailScreen />);

      expect(getByText(/09:00–12:00/)).toBeTruthy();
    });

    // "Retirar oferta" (con Alert.alert de confirmación) se movió a la pantalla de
    // detalle de oferta (MOVO-182, `app/(app)/carrier/offers/[id].tsx`) -- este
    // screen ya no resuelve esa acción inline, solo navega. Ver
    // `test/offer-detail-screen.test.tsx`.
  });
});
