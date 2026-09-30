import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { SummaryStep } from "../components/send/steps/summary-step";
import { shipmentsClient } from "../src/api/shipments-client";
import { useShipmentWizardStore } from "../src/store/shipment-wizard-store";

const mockCreate = jest.fn();

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: { quote: jest.fn() },
}));

jest.mock("../src/hooks/use-shipments", () => ({
  useCreateShipment: () => ({ mutateAsync: mockCreate }),
}));

jest.mock("../components/send/route-map-card", () => ({
  RouteMapCard: () => null,
}));

// El botón real anima un morph en un Modal; acá alcanza con disparar `onPublish` y
// tragarse el error como hace el botón (vuelve a idle y delega en el caller).
jest.mock("../components/send/publish-shipment-button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock no admite imports de afuera
  const { Pressable, Text } = require("react-native");
  return {
    PublishShipmentButton: ({
      onPublish,
      disabled,
      testID,
    }: {
      onPublish: () => Promise<string>;
      disabled?: boolean;
      testID?: string;
    }) => (
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => onPublish().catch(() => {})}
      >
        <Text>Publicar envío</Text>
      </Pressable>
    ),
  };
});

const quoteMock = shipmentsClient.quote as jest.Mock;

function frozenQuote(quoteId: string, suggestedPriceArs: number) {
  return {
    quoteId,
    suggestedPriceArs,
    highDemand: false,
    calculationMethod: "demand_fuel_routes_v1",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

function fillWizard() {
  const store = useShipmentWizardStore.getState();
  store.setPackageType("standard_package");
  store.setWeightKg("3");
  store.setLengthCm("30");
  store.setWidthCm("20");
  store.setHeightCm("15");
  store.setReceiver({
    id: "receiver-1",
    fullName: "ana gómez",
    isVerified: true,
  } as never);
  store.setPickup({
    address: "Av. Colón 1234, Córdoba",
    lat: -31.4201,
    lng: -64.1888,
  } as never);
  store.setDelivery({
    address: "Bv. España 200, Villa María",
    lat: -32.4104,
    lng: -63.2404,
  } as never);
  store.setPickupDate("2030-01-01");
  store.setPickupTimeWindowStart("09:00");
  store.setPickupTimeWindowEnd("12:00");
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
  });
}

describe("SummaryStep — cotización congelada (MOVO-255)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useShipmentWizardStore.getState().resetWizard();
    fillWizard();
  });

  it("cotiza al entrar al resumen y muestra el precio real", async () => {
    quoteMock.mockResolvedValueOnce(frozenQuote("q-1", 30120));

    const { findByText } = await render(<SummaryStep onGoToStep={jest.fn()} />);

    expect(
      await findByText(`$${(30120).toLocaleString("es-AR")}`),
    ).toBeTruthy();
    expect(quoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        packageType: "standard_package",
        weightKg: 3,
        pickupLat: -31.4201,
      }),
    );
  });

  it("crea el envío con el quoteId de la cotización mostrada", async () => {
    quoteMock.mockResolvedValueOnce(frozenQuote("q-1", 30120));
    mockCreate.mockResolvedValueOnce({ id: "shipment-1" });

    const { findByText, getByTestId } = await render(
      <SummaryStep onGoToStep={jest.fn()} />,
    );
    await findByText(`$${(30120).toLocaleString("es-AR")}`);
    await press(getByTestId("summary-step-submit"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ quoteId: "q-1" }),
      ),
    );
  });

  it.each(["QUOTE_EXPIRED", "QUOTE_MISMATCH"])(
    "ante un 409 %s vuelve a cotizar, avisa que el precio cambió y no crea el envío hasta reconfirmar",
    async (code) => {
      quoteMock
        .mockResolvedValueOnce(frozenQuote("q-1", 30120))
        .mockResolvedValueOnce(frozenQuote("q-2", 33500));
      mockCreate
        .mockRejectedValueOnce(
          new ApiError(409, code as never, "La cotización venció."),
        )
        .mockResolvedValueOnce({ id: "shipment-1" });

      const { findByText, getByTestId, findByTestId, queryByTestId } =
        await render(<SummaryStep onGoToStep={jest.fn()} />);
      await findByText(`$${(30120).toLocaleString("es-AR")}`);

      await press(getByTestId("summary-step-submit"));

      expect(await findByTestId("summary-step-price-updated")).toBeTruthy();
      expect(
        await findByText(`$${(33500).toLocaleString("es-AR")}`),
      ).toBeTruthy();
      expect(quoteMock).toHaveBeenCalledTimes(2);
      // Un solo intento de creación: nunca se reintenta solo con el precio nuevo.
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(queryByTestId("summary-step-error")).toBeNull();

      await press(getByTestId("summary-step-submit"));

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
      expect(mockCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({ quoteId: "q-2" }),
      );
    },
  );

  it("si pricing no responde muestra 'Precio a estimar' y crea sin quoteId", async () => {
    quoteMock.mockResolvedValueOnce({
      quoteId: null,
      suggestedPriceArs: null,
      highDemand: null,
      calculationMethod: null,
      expiresAt: null,
    });
    mockCreate.mockResolvedValueOnce({ id: "shipment-1" });

    const { findByText, getByTestId } = await render(
      <SummaryStep onGoToStep={jest.fn()} />,
    );
    await findByText("Precio a estimar");
    await press(getByTestId("summary-step-submit"));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("quoteId");
  });

  it("reusa una cotización vigente al volver al resumen, sin volver a cotizar", async () => {
    useShipmentWizardStore.getState().setPriceQuote({
      ...frozenQuote("q-1", 30120),
      calculationMethod: undefined,
      status: "ready",
      updated: false,
    } as never);

    const { findByText } = await render(<SummaryStep onGoToStep={jest.fn()} />);

    expect(
      await findByText(`$${(30120).toLocaleString("es-AR")}`),
    ).toBeTruthy();
    expect(quoteMock).not.toHaveBeenCalled();
  });
});

describe("shipment-wizard-store — descarte de la cotización (MOVO-255)", () => {
  beforeEach(() => {
    useShipmentWizardStore.getState().resetWizard();
    fillWizard();
    useShipmentWizardStore.getState().setPriceQuote({
      suggestedPriceArs: 30120,
      highDemand: false,
      quoteId: "q-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "ready",
      updated: false,
    });
  });

  it.each([
    ["peso", () => useShipmentWizardStore.getState().setWeightKg("4")],
    ["dimensiones", () => useShipmentWizardStore.getState().setHeightCm("20")],
    [
      "tipo de paquete",
      () => useShipmentWizardStore.getState().setPackageType("fragile_item"),
    ],
    [
      "dirección de entrega",
      () =>
        useShipmentWizardStore
          .getState()
          .setDelivery({ address: "Otra", lat: -32.5, lng: -63.3 } as never),
    ],
  ])("cambiar %s descarta el quoteId", (_label, change) => {
    change();
    expect(useShipmentWizardStore.getState().priceQuote.quoteId).toBeNull();
  });

  it.each([
    [
      "descripción",
      () => useShipmentWizardStore.getState().setDescription("Libros"),
    ],
    [
      "franja horaria",
      () => useShipmentWizardStore.getState().setPickupTimeWindowStart("10:00"),
    ],
    ["el mismo peso", () => useShipmentWizardStore.getState().setWeightKg("3")],
    [
      "la misma dirección con otro texto",
      () =>
        useShipmentWizardStore
          .getState()
          .setDelivery({
            address: "Villa María",
            lat: -32.4104,
            lng: -63.2404,
          } as never),
    ],
  ])("cambiar %s no descarta el quoteId", (_label, change) => {
    change();
    expect(useShipmentWizardStore.getState().priceQuote.quoteId).toBe("q-1");
  });
});
