import { brandFromVehicleLabel } from "../src/data/vehicle-catalog";

describe("brandFromVehicleLabel (MOVO-263)", () => {
  it("saca la marca del catálogo del texto 'marca modelo' del viaje", () => {
    expect(brandFromVehicleLabel("Mercedes-Benz C20")).toBe("Mercedes-Benz");
    expect(brandFromVehicleLabel("Fiat Fiorino")).toBe("Fiat");
  });

  it("ignora tildes y mayúsculas", () => {
    expect(brandFromVehicleLabel("mercedes-benz sprinter")).toBe("Mercedes-Benz");
  });

  it("cae a la primera palabra si la marca no está en el catálogo", () => {
    expect(brandFromVehicleLabel("Marcaxyz Modelo 3")).toBe("Marcaxyz");
  });
});
