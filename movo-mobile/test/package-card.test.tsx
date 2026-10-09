import { render } from "@testing-library/react-native";
import { PackageCard } from "../components/shipments/package-card";

const shipment = {
  id: "shipment-1",
  packageType: "standard_package" as const,
  weightKg: 2,
  lengthCm: 20,
  widthCm: 20,
  heightCm: 20,
  description: "Caja con libros",
};

describe("PackageCard", () => {
  it("muestra tipo, peso, dimensiones y descripción del paquete", async () => {
    const { getByText } = await render(<PackageCard shipment={shipment} />);

    expect(getByText("Encomienda estándar")).toBeTruthy();
    expect(getByText("2 kg · 20 × 20 × 20 cm")).toBeTruthy();
    expect(getByText("Caja con libros")).toBeTruthy();
  });

  it("no muestra fotos: viven en la sección de evidencia", async () => {
    const { queryByText } = await render(<PackageCard shipment={shipment} />);

    expect(queryByText("Sin fotos adjuntas")).toBeNull();
  });
});
