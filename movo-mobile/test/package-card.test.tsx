import { fireEvent, render } from "@testing-library/react-native";
import { PackageCard } from "../components/shipments/package-card";

const mockUseShipmentPhotos = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useShipmentPhotos: () => mockUseShipmentPhotos(),
}));

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
  afterEach(() => jest.clearAllMocks());

  it("muestra tipo, peso, dimensiones y descripción del paquete", async () => {
    mockUseShipmentPhotos.mockReturnValue({ data: undefined, isLoading: false });

    const { getByText } = await render(<PackageCard shipment={shipment} />);

    expect(getByText("Encomienda estándar")).toBeTruthy();
    expect(getByText("2 kg · 20 × 20 × 20 cm")).toBeTruthy();
    expect(getByText("Caja con libros")).toBeTruthy();
  });

  it("muestra el estado vacío cuando no hay fotos adjuntas", async () => {
    mockUseShipmentPhotos.mockReturnValue({ data: [], isLoading: false });

    const { getByText } = await render(<PackageCard shipment={shipment} />);

    expect(getByText("Sin fotos adjuntas")).toBeTruthy();
  });

  it("pluraliza correctamente la cantidad de fotos adjuntas", async () => {
    mockUseShipmentPhotos.mockReturnValue({
      data: [
        { id: "p1", stage: "creation", url: "https://s3/p1", expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" },
        { id: "p2", stage: "creation", url: "https://s3/p2", expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" },
      ],
      isLoading: false,
    });

    const { getByText } = await render(<PackageCard shipment={shipment} />);

    expect(getByText("2 fotos de evidencia")).toBeTruthy();
  });

  it("abre el visor a pantalla completa en la foto tocada y lo cierra", async () => {
    mockUseShipmentPhotos.mockReturnValue({
      data: [
        { id: "p1", stage: "creation", url: "https://s3/p1", expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" },
        { id: "p2", stage: "creation", url: "https://s3/p2", expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" },
      ],
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = await render(<PackageCard shipment={shipment} testID="package" />);

    expect(queryByTestId("package-viewer-close")).toBeNull();

    await fireEvent.press(getByTestId("package-photo-1"));

    expect(getByTestId("package-viewer-close")).toBeTruthy();

    await fireEvent.press(getByTestId("package-viewer-close"));

    expect(queryByTestId("package-viewer-close")).toBeNull();
  });
});
