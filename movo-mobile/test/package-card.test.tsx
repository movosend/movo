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

  it("MOVO-317: un envío oversized avisa 'Más de 300 cm' junto a las medidas", async () => {
    const { getByText } = await render(
      <PackageCard shipment={{ ...shipment, weightKg: 85.5, lengthCm: 300, oversized: true }} />,
    );

    expect(getByText("85.5 kg · 300 × 20 × 20 cm · Más de 300 cm")).toBeTruthy();
  });

  it("MOVO-317: sin oversized no agrega el aviso", async () => {
    const { queryByText } = await render(<PackageCard shipment={{ ...shipment, oversized: false }} />);

    expect(queryByText(/Más de 300 cm/)).toBeNull();
  });

  it("no muestra fotos: viven en la sección de evidencia", async () => {
    const { queryByText } = await render(<PackageCard shipment={shipment} />);

    expect(queryByText("Sin fotos adjuntas")).toBeNull();
  });
});
