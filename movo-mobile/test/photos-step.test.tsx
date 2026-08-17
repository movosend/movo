import { act, fireEvent, render } from "@testing-library/react-native";
import { MAX_PHOTO_COUNT, PhotosStep } from "../components/send/steps/photos-step";
import { useShipmentWizardStore } from "../src/store/shipment-wizard-store";

jest.mock("../src/lib/photo-utils", () => ({
  takePhotoWithCamera: jest.fn(),
  prepareImageForUpload: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "generated-photo-id"),
}));

import { prepareImageForUpload, takePhotoWithCamera } from "../src/lib/photo-utils";

const mockTakePhoto = takePhotoWithCamera as jest.Mock;
const mockPrepare = prepareImageForUpload as jest.Mock;

// MOVO-83, ajuste de UI post-feedback: reemplaza los dos dropzones fijos ("Foto
// 1"/"Foto 2") por un grid con una única celda "Agregar" al final — cubre lo que no
// tenía tests antes (no existía suite de `photos-step`/`photo-slot`).
describe("PhotosStep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useShipmentWizardStore.getState().resetWizard();
  });

  it("arranca con una sola celda de agregar, sin slots vacíos nombrados", async () => {
    const { getByTestId, queryByTestId } = await render(<PhotosStep />);
    expect(getByTestId("photos-step-add")).toBeTruthy();
    expect(queryByTestId("photos-step-slot-0")).toBeNull();
  });

  it("saca la foto sin forzar recorte cuadrado", async () => {
    mockTakePhoto.mockResolvedValue({ cancelled: false, uri: "file:///camera/pkg.jpg" });
    mockPrepare.mockResolvedValue({ uri: "file:///manipulated/pkg.jpg", contentType: "image/jpeg", contentLength: 1000 });

    const { getByTestId } = await render(<PhotosStep />);
    await act(async () => {
      fireEvent.press(getByTestId("photos-step-add"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockTakePhoto).toHaveBeenCalledWith({ allowsEditing: false });
    expect(getByTestId("photos-step-slot-0")).toBeTruthy();
  });

  it("oculta la celda de agregar al llegar al máximo de fotos", async () => {
    const { addPhoto } = useShipmentWizardStore.getState();
    for (let i = 0; i < MAX_PHOTO_COUNT; i++) {
      addPhoto({
        id: `photo-${i}`,
        localUri: `file:///photo-${i}.jpg`,
        status: "uploaded",
        progress: 100,
        s3Key: null,
        errorMessage: null,
      });
    }

    const { queryByTestId } = await render(<PhotosStep />);
    expect(queryByTestId("photos-step-add")).toBeNull();
    expect(queryByTestId(`photos-step-slot-${MAX_PHOTO_COUNT - 1}`)).toBeTruthy();
  });
});
