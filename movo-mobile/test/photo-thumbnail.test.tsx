import { act, fireEvent, render } from "@testing-library/react-native";
import { PhotoThumbnail } from "../components/evidence/photo-thumbnail";
import type { EvidencePhoto } from "../src/hooks/use-evidence-photos";

function photo(overrides: Partial<EvidencePhoto>): EvidencePhoto {
  return {
    id: "p1",
    localUri: "file:///evidence.jpg",
    status: "uploaded",
    progress: 100,
    errorMessage: null,
    ...overrides,
  };
}

describe("PhotoThumbnail", () => {
  it("muestra progreso mientras sube", async () => {
    const { getByText } = await render(
      <PhotoThumbnail
        photo={photo({ status: "uploading", progress: 42 })}
        onRetry={jest.fn()}
        onRemove={jest.fn()}
        size={100}
      />,
    );
    expect(getByText("42%")).toBeTruthy();
  });

  it("no ofrece botón de eliminar una vez confirmada (AC7 recortado, sin DELETE en el backend)", async () => {
    const { queryByTestId } = await render(
      <PhotoThumbnail
        testID="thumb"
        photo={photo({ status: "uploaded" })}
        onRetry={jest.fn()}
        onRemove={jest.fn()}
        size={100}
      />,
    );
    expect(queryByTestId("thumb-remove")).toBeNull();
  });

  it("en error, ofrece reintentar y eliminar", async () => {
    const onRetry = jest.fn();
    const onRemove = jest.fn();
    const { getByTestId } = await render(
      <PhotoThumbnail
        testID="thumb"
        photo={photo({ status: "error", errorMessage: "No se pudo subir." })}
        onRetry={onRetry}
        onRemove={onRemove}
        size={100}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("thumb-retry"));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(getByTestId("thumb-remove"));
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
