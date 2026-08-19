import { addressSelectionToCreateInput } from "../src/lib/address-selection-to-input";
import type { AddressSelection } from "../src/types/address-selection";

// Regresión: `movo-svc-users/addresses.schema.ts` exige `street`/`streetNumber`/
// `city`/`province`/`postalCode`/`country` con `minLength: 1` — antes de este fix,
// `streetNumber`/`province`/`postalCode` viajaban siempre `""`, y el 400 resultante
// hacía que el alta de una dirección elegida por búsqueda fallara SIEMPRE, no como
// una excepción (bug reportado por el usuario en MOVO-121).
describe("addressSelectionToCreateInput", () => {
  it("separa calle y altura cuando el primer segmento termina en un número", () => {
    const selection: AddressSelection = {
      address: "Av. Colón 1000, Córdoba, Córdoba, Argentina",
      lat: -31.4,
      lng: -64.18,
      source: "places",
    };

    const input = addressSelectionToCreateInput(selection);

    expect(input.street).toBe("Av. Colón");
    expect(input.streetNumber).toBe("1000");
    expect(input.city).toBe("Córdoba");
    expect(input.province).toBe("Córdoba");
  });

  it("nunca manda campos vacíos aunque el texto no tenga estructura reconocible", () => {
    const selection: AddressSelection = {
      address: "Ubicación actual",
      lat: -31.4,
      lng: -64.18,
      source: "gps",
    };

    const input = addressSelectionToCreateInput(selection);

    expect(input.street).not.toBe("");
    expect(input.streetNumber).not.toBe("");
    expect(input.city).not.toBe("");
    expect(input.province).not.toBe("");
    expect(input.postalCode).not.toBe("");
    expect(input.country).not.toBe("");
  });

  it("conserva lat/lng tal cual", () => {
    const selection: AddressSelection = {
      address: "Bv. San Juan 500, Córdoba",
      lat: -31.4135,
      lng: -64.181,
      source: "map-pin",
    };

    const input = addressSelectionToCreateInput(selection);

    expect(input.lat).toBe(-31.4135);
    expect(input.long).toBe(-64.181);
  });
});
