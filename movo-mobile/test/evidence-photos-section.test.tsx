import { fireEvent, render } from "@testing-library/react-native";
import { EvidencePhotosSection } from "../components/shipments/evidence-photos-section";

const mockUseShipmentPhotos = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useShipmentPhotos: () => mockUseShipmentPhotos(),
}));

function photo(id: string, stage: "creation" | "pickup" | "delivery") {
  return { id, stage, url: `https://s3/${id}`, expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" };
}

describe("EvidencePhotosSection", () => {
  afterEach(() => jest.clearAllMocks());

  it("agrupa las fotos por stage en orden creation, pickup, delivery", async () => {
    mockUseShipmentPhotos.mockReturnValue({
      data: [photo("d1", "delivery"), photo("c1", "creation"), photo("p1", "pickup"), photo("c2", "creation")],
    });

    const { getByTestId, getByText, toJSON } = await render(
      <EvidencePhotosSection shipmentId="shipment-1" testID="evidence" />,
    );

    expect(getByText("Evidencia")).toBeTruthy();
    expect(getByText("Al publicar · 2")).toBeTruthy();
    expect(getByText("Retiro · 1")).toBeTruthy();
    expect(getByText("Entrega · 1")).toBeTruthy();

    const serialized = JSON.stringify(toJSON());
    const order = ["evidence-creation", "evidence-pickup", "evidence-delivery"].map((id) => serialized.indexOf(`"${id}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(getByTestId("evidence-creation-photo-1")).toBeTruthy();
  });

  it("no muestra un stage sin fotos", async () => {
    mockUseShipmentPhotos.mockReturnValue({ data: [photo("c1", "creation"), photo("d1", "delivery")] });

    const { queryByTestId } = await render(<EvidencePhotosSection shipmentId="shipment-1" testID="evidence" />);

    expect(queryByTestId("evidence-creation")).toBeTruthy();
    expect(queryByTestId("evidence-pickup")).toBeNull();
    expect(queryByTestId("evidence-delivery")).toBeTruthy();
  });

  it.each([[[]], [undefined]])("no renderiza la sección sin fotos (%p)", async (data) => {
    mockUseShipmentPhotos.mockReturnValue({ data });

    const { queryByTestId, queryByText } = await render(
      <EvidencePhotosSection shipmentId="shipment-1" testID="evidence" />,
    );

    expect(queryByTestId("evidence")).toBeNull();
    expect(queryByText("Evidencia")).toBeNull();
  });

  it("abre el visor al tocar una miniatura y lo cierra", async () => {
    mockUseShipmentPhotos.mockReturnValue({ data: [photo("c1", "creation"), photo("p1", "pickup")] });

    const { getByTestId, queryByTestId } = await render(
      <EvidencePhotosSection shipmentId="shipment-1" testID="evidence" />,
    );

    expect(queryByTestId("evidence-viewer-close")).toBeNull();
    await fireEvent.press(getByTestId("evidence-pickup-photo-0"));
    expect(getByTestId("evidence-viewer-close")).toBeTruthy();
    await fireEvent.press(getByTestId("evidence-viewer-close"));
    expect(queryByTestId("evidence-viewer-close")).toBeNull();
  });
});
