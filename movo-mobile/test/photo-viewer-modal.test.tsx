import { fireEvent, render } from "@testing-library/react-native";
import { PhotoViewerModal } from "../components/shipments/photo-viewer-modal";
import type { ShipmentPhoto } from "../src/api/shipments-client";

const photos: ShipmentPhoto[] = [
  { id: "p1", stage: "creation", url: "https://s3/p1", expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" },
  { id: "p2", stage: "creation", url: "https://s3/p2", expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" },
  { id: "p3", stage: "creation", url: "https://s3/p3", expiresIn: 300, createdAt: "2026-08-15T10:00:00.000Z" },
];

describe("PhotoViewerModal", () => {
  it("no renderiza nada si no hay fotos", async () => {
    const { queryByTestId } = await render(
      <PhotoViewerModal photos={[]} initialIndex={0} visible onClose={jest.fn()} testID="viewer" />,
    );

    expect(queryByTestId("viewer-close")).toBeNull();
  });

  it("no muestra el visor cuando `visible` es false", async () => {
    const { queryByTestId } = await render(
      <PhotoViewerModal photos={photos} initialIndex={0} visible={false} onClose={jest.fn()} testID="viewer" />,
    );

    expect(queryByTestId("viewer-close")).toBeNull();
  });

  it("muestra el contador de la foto inicial y llama a onClose al tocar cerrar", async () => {
    const onClose = jest.fn();

    const { getByText, getByTestId } = await render(
      <PhotoViewerModal photos={photos} initialIndex={1} visible onClose={onClose} testID="viewer" />,
    );

    expect(getByText("2 / 3")).toBeTruthy();

    await fireEvent.press(getByTestId("viewer-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Simular el gesto de pinch/pan real requeriría `fireGestureHandler` de
  // `react-native-gesture-handler/jestUtils` contra el handler nativo mockeado — acá
  // solo se verifica que cada foto monta su `ZoomableImage` (wiring), no la mecánica
  // de zoom en sí (cubierta manualmente en device, feedback post-QA que pidió esta
  // funcionalidad).
  it("monta una imagen zoomeable por cada foto", async () => {
    const { getByTestId } = await render(
      <PhotoViewerModal photos={photos} initialIndex={0} visible onClose={jest.fn()} testID="viewer" />,
    );

    expect(getByTestId("viewer-image-0")).toBeTruthy();
    expect(getByTestId("viewer-image-1")).toBeTruthy();
    expect(getByTestId("viewer-image-2")).toBeTruthy();
  });
});
