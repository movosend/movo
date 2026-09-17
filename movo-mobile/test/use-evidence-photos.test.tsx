import { act, renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEvidencePhotos } from "../src/hooks/use-evidence-photos";

jest.mock("expo-crypto", () => {
  let mockNextPhotoId = 0;
  return { randomUUID: jest.fn(() => `generated-photo-id-${mockNextPhotoId++}`) };
});

jest.mock("../src/lib/photo-utils", () => ({
  takePhotoWithCamera: jest.fn(),
  prepareImageForUpload: jest.fn(),
  uriToBlob: jest.fn(),
}));

jest.mock("../src/adapters/photo-upload-provider", () => ({
  createPhotoUploadProvider: jest.fn(),
}));

import { prepareImageForUpload, takePhotoWithCamera } from "../src/lib/photo-utils";
import { createPhotoUploadProvider } from "../src/adapters/photo-upload-provider";

const mockTakePhoto = takePhotoWithCamera as jest.Mock;
const mockPrepare = prepareImageForUpload as jest.Mock;
const mockCreateProvider = createPhotoUploadProvider as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useEvidencePhotos (MOVO-197)", () => {
  let requestUploadUrl: jest.Mock;
  let uploadToUrl: jest.Mock;
  let confirmUpload: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    requestUploadUrl = jest.fn().mockResolvedValue({ uploadUrl: "https://s3/upload", s3Key: "shipments/s1/pickup/x.jpg" });
    uploadToUrl = jest.fn().mockResolvedValue(undefined);
    confirmUpload = jest.fn().mockResolvedValue(undefined);
    mockCreateProvider.mockReturnValue({ requestUploadUrl, uploadToUrl, confirmUpload });
    mockPrepare.mockResolvedValue({
      uri: "file:///manipulated/evidence.jpg",
      contentType: "image/jpeg",
      contentLength: 1000,
      blob: { size: 1000 },
    });
  });

  it("sube una foto de punta a punta (presign, PUT, confirm) y queda 'uploaded'", async () => {
    mockTakePhoto.mockResolvedValue({ cancelled: false, uri: "file:///camera/pickup.jpg" });

    const { result } = await renderHook(() => useEvidencePhotos("s1", "pickup"), { wrapper });

    await act(async () => {
      await result.current.capture();
    });

    expect(requestUploadUrl).toHaveBeenCalledWith("s1", "pickup", "image/jpeg", 1000);
    expect(confirmUpload).toHaveBeenCalledWith("s1", "shipments/s1/pickup/x.jpg", "pickup");
    expect(result.current.photos).toHaveLength(1);
    expect(result.current.photos[0].status).toBe("uploaded");
    expect(result.current.confirmedThisSession).toBe(1);
  });

  it("permiso denegado reintentable no crea ninguna foto y expone el issue", async () => {
    mockTakePhoto.mockResolvedValue({ cancelled: true, permissionDenied: true, canAskAgain: true });

    const { result } = await renderHook(() => useEvidencePhotos("s1", "pickup"), { wrapper });
    await act(async () => {
      await result.current.capture();
    });

    expect(result.current.photos).toHaveLength(0);
    expect(result.current.issue).toEqual({ type: "denied", canAskAgain: true });
  });

  it("permiso denegado para siempre expone canAskAgain: false", async () => {
    mockTakePhoto.mockResolvedValue({ cancelled: true, permissionDenied: true, canAskAgain: false });

    const { result } = await renderHook(() => useEvidencePhotos("s1", "pickup"), { wrapper });
    await act(async () => {
      await result.current.capture();
    });

    expect(result.current.issue).toEqual({ type: "denied", canAskAgain: false });
  });

  it("cámara no disponible expone el issue 'unavailable', sin ofrecer galería", async () => {
    mockTakePhoto.mockResolvedValue({ cancelled: true, unavailable: true });

    const { result } = await renderHook(() => useEvidencePhotos("s1", "delivery"), { wrapper });
    await act(async () => {
      await result.current.capture();
    });

    expect(result.current.photos).toHaveLength(0);
    expect(result.current.issue).toEqual({ type: "unavailable" });
  });

  it("cancelar la captura no deja ningún issue accionable", async () => {
    mockTakePhoto.mockResolvedValue({ cancelled: true });

    const { result } = await renderHook(() => useEvidencePhotos("s1", "pickup"), { wrapper });
    await act(async () => {
      await result.current.capture();
    });

    expect(result.current.photos).toHaveLength(0);
    expect(result.current.issue).toEqual({ type: "cancelled" });
  });

  it("fallo de red a mitad de subida deja la foto en error, sin perder las ya confirmadas, y el retry la recupera", async () => {
    mockTakePhoto
      .mockResolvedValueOnce({ cancelled: false, uri: "file:///camera/ok.jpg" })
      .mockResolvedValueOnce({ cancelled: false, uri: "file:///camera/fails.jpg" });
    uploadToUrl.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network"));

    const { result } = await renderHook(() => useEvidencePhotos("s1", "pickup"), { wrapper });

    await act(async () => {
      await result.current.capture();
    });
    await act(async () => {
      await result.current.capture();
    });

    expect(result.current.photos).toHaveLength(2);
    expect(result.current.photos[0].status).toBe("uploaded");
    expect(result.current.photos[1].status).toBe("error");
    expect(result.current.confirmedThisSession).toBe(1);

    uploadToUrl.mockResolvedValueOnce(undefined);
    const failedId = result.current.photos[1].id;
    await act(async () => {
      await result.current.retry(failedId);
    });

    expect(result.current.photos[0].status).toBe("uploaded");
    expect(result.current.photos[1].status).toBe("uploaded");
    expect(result.current.confirmedThisSession).toBe(2);
  });

  it("no permite eliminar una foto ya confirmada, solo las que fallaron", async () => {
    mockTakePhoto
      .mockResolvedValueOnce({ cancelled: false, uri: "file:///camera/ok.jpg" })
      .mockResolvedValueOnce({ cancelled: false, uri: "file:///camera/fails.jpg" });
    uploadToUrl.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network"));

    const { result } = await renderHook(() => useEvidencePhotos("s1", "pickup"), { wrapper });
    await act(async () => {
      await result.current.capture();
    });
    await act(async () => {
      await result.current.capture();
    });

    const [uploadedPhoto, erroredPhoto] = result.current.photos;

    await act(async () => {
      result.current.remove(uploadedPhoto.id);
    });
    expect(result.current.photos).toHaveLength(2);

    await act(async () => {
      result.current.remove(erroredPhoto.id);
    });
    expect(result.current.photos).toHaveLength(1);
    expect(result.current.photos[0].id).toBe(uploadedPhoto.id);
  });
});
