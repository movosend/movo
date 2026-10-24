import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useSupportPhotos } from "../src/hooks/use-support-photos";

let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `photo-${++mockUuid}` }));

const mockUpload = jest.fn();
jest.mock("../src/api/support-client", () => ({ supportClient: { uploadAttachment: (...args: unknown[]) => mockUpload(...args) } }));

const mockPick = jest.fn();
const mockTake = jest.fn();
const mockPrepare = jest.fn();
jest.mock("../src/lib/photo-utils", () => ({
  pickPhotoFromGallery: (...args: unknown[]) => mockPick(...args),
  takePhotoWithCamera: (...args: unknown[]) => mockTake(...args),
  prepareImageForUpload: (...args: unknown[]) => mockPrepare(...args),
  uriToBlob: jest.fn(),
}));

/** `Alert.alert("Agregar foto", …)`: elige una opción por su texto. */
function chooseFromAlert(label: string) {
  jest.spyOn(Alert, "alert").mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
}

const picked = (n: number) => ({ cancelled: false, permissionDenied: false, uri: `file:///${n}.jpg` });

describe("useSupportPhotos (MOVO-324)", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockUuid = 0;
    mockPrepare.mockResolvedValue({ uri: "file:///small.jpg", contentType: "image/jpeg", contentLength: 1000, blob: { size: 1000 } });
    mockUpload.mockResolvedValue({ attachmentId: "att-1" });
  });

  it("sube cada foto apenas se elige y guarda el id del adjunto", async () => {
    chooseFromAlert("Elegir de la galería");
    mockPick.mockResolvedValue(picked(1));
    const { result } = await renderHook(() => useSupportPhotos("c1"));

    await act(async () => result.current.add());

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("uploaded"));
    expect(mockPrepare).toHaveBeenCalledWith("file:///1.jpg", { maxDimension: 1600, quality: 0.7 });
    expect(mockUpload).toHaveBeenCalledWith({ size: 1000 }, "image/jpeg", "c1");
    expect(result.current.uploadedIds).toEqual(["att-1"]);
    expect(result.current.hasPending).toBe(false);
  });

  it("una consulta nueva (sin conversationId) sube sin él", async () => {
    chooseFromAlert("Sacar una foto");
    mockTake.mockResolvedValue(picked(1));
    const { result } = await renderHook(() => useSupportPhotos());

    await act(async () => result.current.add());
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("uploaded"));

    expect(mockUpload).toHaveBeenCalledWith({ size: 1000 }, "image/jpeg", undefined);
  });

  it("tope de 4: no deja agregar la quinta", async () => {
    chooseFromAlert("Elegir de la galería");
    let n = 0;
    mockPick.mockImplementation(async () => picked(++n));
    mockUpload.mockImplementation(async () => ({ attachmentId: `att-${n}` }));
    const { result } = await renderHook(() => useSupportPhotos("c1"));

    for (let i = 0; i < 5; i += 1) {
      await act(async () => result.current.add());
    }
    await waitFor(() => expect(result.current.photos.every((p) => p.status === "uploaded")).toBe(true));

    expect(result.current.photos).toHaveLength(4);
    expect(result.current.canAddMore).toBe(false);
    expect(mockPick).toHaveBeenCalledTimes(4);
    expect(result.current.max).toBe(4);
  });

  it("una foto que falla queda en error, bloquea el envío y se puede reintentar", async () => {
    chooseFromAlert("Elegir de la galería");
    mockPick.mockResolvedValue(picked(1));
    mockUpload.mockRejectedValueOnce(new Error("red")).mockResolvedValueOnce({ attachmentId: "att-9" });
    const { result } = await renderHook(() => useSupportPhotos("c1"));

    await act(async () => result.current.add());
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("error"));
    expect(result.current.hasPending).toBe(true);
    expect(result.current.uploadedIds).toEqual([]);

    await act(async () => result.current.retry(result.current.photos[0].id));
    await waitFor(() => expect(result.current.photos[0]?.status).toBe("uploaded"));
    expect(result.current.uploadedIds).toEqual(["att-9"]);
  });

  it("una foto de más de 5 MB se rechaza antes de subir", async () => {
    chooseFromAlert("Elegir de la galería");
    mockPick.mockResolvedValue(picked(1));
    mockPrepare.mockResolvedValue({ uri: "x", contentType: "image/jpeg", contentLength: 6 * 1024 * 1024, blob: { size: 6 * 1024 * 1024 } });
    const { result } = await renderHook(() => useSupportPhotos("c1"));

    await act(async () => result.current.add());

    await waitFor(() => expect(result.current.photos[0]?.status).toBe("error"));
    expect(result.current.photos[0].errorMessage).toMatch(/muy pesada/);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("quitar libera lugar y reset vacía todo", async () => {
    chooseFromAlert("Elegir de la galería");
    mockPick.mockResolvedValue(picked(1));
    const { result } = await renderHook(() => useSupportPhotos("c1"));
    await act(async () => result.current.add());
    await waitFor(() => expect(result.current.photos).toHaveLength(1));

    await act(async () => result.current.remove(result.current.photos[0].id));
    expect(result.current.photos).toHaveLength(0);

    await act(async () => result.current.add());
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    await act(async () => result.current.reset());
    expect(result.current.photos).toHaveLength(0);
  });

  it("cancelar el selector no agrega nada; sin permiso avisa", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((title, _m, buttons) => {
      if (title === "Agregar foto") buttons?.find((b) => b.text === "Elegir de la galería")?.onPress?.();
    });
    mockPick.mockResolvedValueOnce({ cancelled: true, permissionDenied: false, uri: null });
    const { result } = await renderHook(() => useSupportPhotos("c1"));
    await act(async () => result.current.add());
    expect(result.current.photos).toHaveLength(0);

    mockPick.mockResolvedValueOnce({ cancelled: false, permissionDenied: true, uri: null });
    await act(async () => result.current.add());
    expect(result.current.photos).toHaveLength(0);
    expect(alertSpy).toHaveBeenCalledWith("Permiso necesario", expect.any(String), expect.any(Array));
  });
});
