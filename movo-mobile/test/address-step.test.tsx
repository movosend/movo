import { render } from "@testing-library/react-native";
import { AddressStep, isAddressStepValid } from "../components/send/steps/address-step";
import { useShipmentWizardStore } from "../src/store/shipment-wizard-store";
import type { AddressSelection } from "../src/store/shipment-wizard-store";

jest.mock("../src/api/places-client", () => ({
  placesClient: { autocomplete: jest.fn(), details: jest.fn() },
}));

jest.mock("../src/hooks/use-addresses", () => ({
  useAddresses: jest.fn(() => ({ data: [] })),
  useCreateAddress: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("../src/lib/location.ts", () => ({
  getCurrentLocation: jest.fn(),
}));

const CORDOBA: AddressSelection = { address: "Av. Colón 1000, Córdoba", lat: -31.4201, lng: -64.1888, source: "places" };
// ~1.04km de CORDOBA — bien por encima del umbral de 100m.
const FAR_AWAY: AddressSelection = { address: "Bv. San Juan 500, Córdoba", lat: -31.4135, lng: -64.181, source: "places" };
// ~50m de CORDOBA — por debajo del umbral de 100m.
const TOO_CLOSE: AddressSelection = { address: "Av. Colón 1010, Córdoba", lat: -31.42055, lng: -64.1888, source: "places" };

const VALID_WINDOW = {
  pickupDate: "2099-01-01",
  pickupTimeWindowStart: "09:00",
  pickupTimeWindowEnd: "12:00",
};

// MOVO-126, feedback de UX: el rechazo de retiro/entrega en la misma ubicación (o a
// menos de 100m) tiene que verse apenas se elige la segunda dirección, no recién al
// fallar el submit del resumen — mismo umbral que ya valida el backend.
describe("isAddressStepValid — retiro y entrega no pueden ser la misma ubicación", () => {
  it("rechaza retiro y entrega en exactamente el mismo punto", () => {
    expect(isAddressStepValid({ pickup: CORDOBA, delivery: CORDOBA, ...VALID_WINDOW })).toBe(false);
  });

  it("rechaza retiro y entrega a ~50m entre sí, por debajo del umbral de 100m", () => {
    expect(isAddressStepValid({ pickup: CORDOBA, delivery: TOO_CLOSE, ...VALID_WINDOW })).toBe(false);
  });

  it("acepta retiro y entrega a más de 100m entre sí", () => {
    expect(isAddressStepValid({ pickup: CORDOBA, delivery: FAR_AWAY, ...VALID_WINDOW })).toBe(true);
  });
});

describe("AddressStep — error inline de ubicaciones muy cercanas", () => {
  beforeEach(() => {
    useShipmentWizardStore.getState().resetWizard();
  });

  it("no muestra el error sin ambas direcciones cargadas", async () => {
    const { queryByTestId } = await render(<AddressStep />);
    expect(queryByTestId("address-step-same-location-error")).toBeNull();
  });

  it("muestra el error cuando retiro y entrega están a menos de 100m", async () => {
    useShipmentWizardStore.getState().setPickup(CORDOBA);
    useShipmentWizardStore.getState().setDelivery(TOO_CLOSE);

    const { getByTestId } = await render(<AddressStep />);
    expect(getByTestId("address-step-same-location-error")).toBeTruthy();
  });

  it("no muestra el error cuando retiro y entrega están suficientemente separados", async () => {
    useShipmentWizardStore.getState().setPickup(CORDOBA);
    useShipmentWizardStore.getState().setDelivery(FAR_AWAY);

    const { queryByTestId } = await render(<AddressStep />);
    expect(queryByTestId("address-step-same-location-error")).toBeNull();
  });
});
