import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { PhotoPicker } from "../components/profile/photo-picker";
import { usersClient } from "../src/api/users-client";
import * as photoUtils from "../src/lib/photo-utils";

jest.mock("../src/api/users-client", () => ({
  usersClient: {
    getPhotoUploadUrl: jest.fn(),
    confirmPhoto: jest.fn(),
    deletePhoto: jest.fn(),
    uploadPhotoToS3: jest.fn(),
  },
}));

jest.mock("../src/lib/photo-utils", () => ({
  prepareProfilePhoto: jest.fn(),
  takePhotoWithCamera: jest.fn(),
  pickPhotoFromGallery: jest.fn(),
}));

describe("PhotoPicker", () => {
  const mockOnPhotoUpdated = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert");
    jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
  });

  it("renderiza el avatar con iniciales cuando no hay foto cargada", async () => {
    const { getByText, queryByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl={null}
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
      />,
    );

    expect(getByText("TO")).toBeTruthy();
    expect(queryByTestId("photo-picker-error")).toBeNull();
  });

  it("renderiza la imagen cuando hay photoUrl", async () => {
    const { getByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl="https://s3.amazonaws.com/bucket/profile-photos/u1.jpg"
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
      />,
    );

    const avatar = getByTestId("photo-picker-avatar");
    expect(avatar.props.source).toEqual({
      uri: "https://s3.amazonaws.com/bucket/profile-photos/u1.jpg",
    });
  });

  it("muestra botones directos de cámara y galería cuando showDirectButtons es true", async () => {
    const { getByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl={null}
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
        showDirectButtons
      />,
    );

    expect(getByTestId("photo-picker-camera-btn")).toBeTruthy();
    expect(getByTestId("photo-picker-gallery-btn")).toBeTruthy();
  });

  it("alerta y ofrece ir a Ajustes si el permiso de cámara es denegado", async () => {
    (photoUtils.takePhotoWithCamera as jest.Mock).mockResolvedValue({
      cancelled: true,
      permissionDenied: true,
    });

    const { getByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl={null}
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
        showDirectButtons
      />,
    );

    await fireEvent.press(getByTestId("photo-picker-camera-btn"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Permiso necesario",
      expect.stringMatching(/acceso a tu cámara/i),
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancelar" }),
        expect.objectContaining({ text: "Abrir Ajustes" }),
      ]),
    );

    // Simular presionar "Abrir Ajustes"
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const openSettingsBtn = alertCall[2].find(
      (b: { text: string }) => b.text === "Abrir Ajustes",
    );
    openSettingsBtn.onPress();
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it("alerta y ofrece ir a Ajustes si el permiso de galería es denegado", async () => {
    (photoUtils.pickPhotoFromGallery as jest.Mock).mockResolvedValue({
      cancelled: true,
      permissionDenied: true,
    });

    const { getByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl={null}
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
        showDirectButtons
      />,
    );

    await fireEvent.press(getByTestId("photo-picker-gallery-btn"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "Permiso necesario",
      expect.stringMatching(/acceso a tu fotos/i),
      expect.any(Array),
    );
  });

  it("completa el flujo de subida a S3 exitosamente y notifica la nueva URL", async () => {
    (photoUtils.pickPhotoFromGallery as jest.Mock).mockResolvedValue({
      cancelled: false,
      uri: "file:///local/picker_image.jpg",
    });
    (photoUtils.prepareProfilePhoto as jest.Mock).mockResolvedValue({
      uri: "file:///local/compressed.jpg",
      contentType: "image/jpeg",
      contentLength: 20480,
    });
    (usersClient.getPhotoUploadUrl as jest.Mock).mockResolvedValue({
      uploadUrl: "https://s3.amazonaws.com/upload-target",
      objectKey: "profile-photos/u1/photo.jpg",
      expiresIn: 300,
    });
    (usersClient.uploadPhotoToS3 as jest.Mock).mockResolvedValue(undefined);
    (usersClient.confirmPhoto as jest.Mock).mockResolvedValue({
      photoUrl: "https://s3.amazonaws.com/bucket/profile-photos/u1/photo.jpg",
    });

    const { getByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl={null}
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
        showDirectButtons
      />,
    );

    await fireEvent.press(getByTestId("photo-picker-gallery-btn"));

    await waitFor(() => {
      expect(photoUtils.prepareProfilePhoto).toHaveBeenCalledWith(
        "file:///local/picker_image.jpg",
      );
      expect(usersClient.getPhotoUploadUrl).toHaveBeenCalledWith({
        contentType: "image/jpeg",
        contentLength: 20480,
      });
      expect(usersClient.uploadPhotoToS3).toHaveBeenCalledWith(
        "https://s3.amazonaws.com/upload-target",
        "file:///local/compressed.jpg",
        "image/jpeg",
        20480,
      );
      expect(usersClient.confirmPhoto).toHaveBeenCalledWith({
        objectKey: "profile-photos/u1/photo.jpg",
      });
      expect(mockOnPhotoUpdated).toHaveBeenCalledWith(
        "https://s3.amazonaws.com/bucket/profile-photos/u1/photo.jpg",
      );
    });
  });

  it("muestra banner de error si la subida a S3 falla y permite reintentar", async () => {
    (photoUtils.takePhotoWithCamera as jest.Mock).mockResolvedValue({
      cancelled: false,
      uri: "file:///local/camera_image.jpg",
    });
    (photoUtils.prepareProfilePhoto as jest.Mock).mockResolvedValue({
      uri: "file:///local/compressed.jpg",
      contentType: "image/jpeg",
      contentLength: 1024,
    });
    (usersClient.getPhotoUploadUrl as jest.Mock).mockResolvedValue({
      uploadUrl: "https://s3.amazonaws.com/upload-target",
      objectKey: "profile-photos/u1/photo.jpg",
      expiresIn: 300,
    });
    (usersClient.uploadPhotoToS3 as jest.Mock).mockRejectedValue(
      new Error("Network failed"),
    );

    const { getByTestId, findByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl={null}
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
        showDirectButtons
      />,
    );

    await fireEvent.press(getByTestId("photo-picker-camera-btn"));

    const errorBanner = await findByTestId("photo-picker-error");
    expect(errorBanner).toBeTruthy();
    expect(mockOnPhotoUpdated).not.toHaveBeenCalled();
  });

  it("permite eliminar foto actual", async () => {
    (usersClient.deletePhoto as jest.Mock).mockResolvedValue(undefined);

    const { getByTestId, findByTestId } = await render(
      <PhotoPicker
        currentPhotoUrl="https://s3.amazonaws.com/bucket/profile-photos/u1.jpg"
        fullName="Tomas Olmos"
        onPhotoUpdated={mockOnPhotoUpdated}
      />,
    );

    // Abre el modal al tocar el avatar
    await fireEvent.press(getByTestId("photo-picker-avatar-button"));

    const deleteBtn = await findByTestId("photo-picker-modal-delete");
    await fireEvent.press(deleteBtn);

    await waitFor(() => {
      expect(usersClient.deletePhoto).toHaveBeenCalled();
      expect(mockOnPhotoUpdated).toHaveBeenCalledWith(null);
    });
  });
});
