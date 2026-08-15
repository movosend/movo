import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  prepareProfilePhoto,
  takePhotoWithCamera,
  pickPhotoFromGallery,
} from "../src/lib/photo-utils";

jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

describe("photo-utils", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe("prepareProfilePhoto", () => {
    it("redimensiona y comprime la imagen y devuelve el tamaño en bytes", async () => {
      (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({
        uri: "file:///manipulated/photo.jpg",
        width: 1024,
        height: 1024,
      });

      const mockBlob = { size: 154320 };
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        blob: jest.fn().mockResolvedValue(mockBlob),
      });

      const result = await prepareProfilePhoto("file:///original/photo.jpg");

      expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
        "file:///original/photo.jpg",
        [{ resize: { width: 1024 } }],
        {
          compress: 0.8,
          format: "jpeg",
        },
      );
      expect(result).toEqual({
        uri: "file:///manipulated/photo.jpg",
        contentType: "image/jpeg",
        contentLength: 154320,
        blob: mockBlob,
      });
    });

    it("lanza error si la lectura de la imagen manipulada falla", async () => {
      (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({
        uri: "file:///manipulated/photo.jpg",
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
      });

      await expect(
        prepareProfilePhoto("file:///original/photo.jpg"),
      ).rejects.toThrow(/No se pudo procesar/);
    });
  });

  describe("takePhotoWithCamera", () => {
    it("devuelve permissionDenied si el permiso de cámara no es otorgado", async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: false,
      });

      const result = await takePhotoWithCamera();

      expect(result).toEqual({ cancelled: true, permissionDenied: true });
      expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    });

    it("abre la cámara con recorte 1:1 y devuelve la URI", async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: true,
      });
      (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: "file:///camera/photo.jpg" }],
      });

      const result = await takePhotoWithCamera();

      expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      expect(result).toEqual({
        cancelled: false,
        uri: "file:///camera/photo.jpg",
      });
    });

    it("maneja cancelación de la cámara", async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: true,
      });
      (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
        canceled: true,
      });

      const result = await takePhotoWithCamera();

      expect(result).toEqual({ cancelled: true });
    });
  });

  describe("pickPhotoFromGallery", () => {
    it("devuelve permissionDenied si el permiso de galería no es otorgado", async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: false,
      });

      const result = await pickPhotoFromGallery();

      expect(result).toEqual({ cancelled: true, permissionDenied: true });
      expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    });

    it("abre la galería con recorte 1:1 y devuelve la URI", async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: true,
      });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: "file:///gallery/photo.jpg" }],
      });

      const result = await pickPhotoFromGallery();

      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      expect(result).toEqual({
        cancelled: false,
        uri: "file:///gallery/photo.jpg",
      });
    });
  });
});
