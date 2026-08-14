import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@movo/shared";

// Única excepción justificada a "nunca mockeado" (regla de CLAUDE.md para tests de
// integración contra DB/Redis reales), mismo criterio que `twilio-sms-provider.test.ts`:
// S3 es una API externa de AWS, pegarle de verdad en cada corrida de CI depende de un
// bucket/credenciales reales que no existen en dev/test/CI (MOVO-97 default es
// STORAGE_PROVIDER=mock). Se mockea el SDK, no la lógica del adapter.
const sendMock = vi.fn();
// Función regular (no arrow) a propósito: `new S3Client(...)` necesita algo
// construible -- una arrow function no lo es, `vi.fn(() => ...)` tira
// "is not a constructor" en cuanto el adapter hace `new S3Client(...)`.
const s3ClientMock = vi.fn(function S3ClientMock() {
  return { send: sendMock };
});
const getSignedUrlMock = vi.fn().mockResolvedValue("https://signed.example.com/profile-photos/user/1.jpg");

vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
  return { ...actual, S3Client: s3ClientMock };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: getSignedUrlMock }));

const { createS3StorageProvider } = await import("../../src/adapters/s3-storage-provider");

describe("S3 Storage Provider (adapter concreto, MOVO-97)", () => {
  beforeEach(() => {
    sendMock.mockReset();
    getSignedUrlMock.mockClear();
    s3ClientMock.mockClear();
  });

  const provider = createS3StorageProvider({ bucketName: "movo-dev-bucket", region: "us-east-1" });

  it("firma la URL de subida con Content-Type/Content-Length como signableHeaders (AC2)", async () => {
    const result = await provider.createUploadUrl({
      key: "profile-photos/user-1/photo.jpg",
      contentType: "image/jpeg",
      contentLength: 1024,
    });

    expect(result).toEqual({ uploadUrl: "https://signed.example.com/profile-photos/user/1.jpg", expiresIn: 300 });
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, command, options] = getSignedUrlMock.mock.calls[0];
    expect(command.input).toMatchObject({
      Bucket: "movo-dev-bucket",
      Key: "profile-photos/user-1/photo.jpg",
      ContentType: "image/jpeg",
      ContentLength: 1024,
    });
    expect(options).toMatchObject({ expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) });
  });

  it("headObject: objeto existente devuelve exists:true con contentType/contentLength reales", async () => {
    sendMock.mockResolvedValueOnce({ ContentType: "image/png", ContentLength: 2048 });

    const result = await provider.headObject("profile-photos/user-1/photo.png");

    expect(result).toEqual({ exists: true, contentType: "image/png", contentLength: 2048 });
  });

  it("headObject: objeto inexistente (NotFound de S3) devuelve exists:false sin tirar", async () => {
    sendMock.mockRejectedValueOnce({ name: "NotFound" });

    const result = await provider.headObject("profile-photos/user-1/nope.jpg");

    expect(result).toEqual({ exists: false });
  });

  it("headObject: un error real de S3 (no NotFound) se traduce a ApiError 502 STORAGE_PROVIDER_ERROR", async () => {
    sendMock.mockRejectedValueOnce(new Error("credentials expired"));

    await expect(provider.headObject("profile-photos/user-1/photo.jpg")).rejects.toMatchObject({
      statusCode: 502,
      code: "STORAGE_PROVIDER_ERROR",
    });
  });

  it("getPublicUrl / getKeyFromUrl son inversas exactas (round-trip)", () => {
    const key = "profile-photos/user-1/abc-123.jpg";
    const url = provider.getPublicUrl(key);

    expect(url).toBe("https://movo-dev-bucket.s3.us-east-1.amazonaws.com/profile-photos/user-1/abc-123.jpg");
    expect(provider.getKeyFromUrl(url)).toBe(key);
  });

  it("getKeyFromUrl devuelve null para una URL que no pertenece a este bucket/región", () => {
    expect(provider.getKeyFromUrl("https://otro-bucket.s3.us-east-1.amazonaws.com/x.jpg")).toBeNull();
    expect(provider.getKeyFromUrl("no-es-una-url")).toBeNull();
  });

  it("deleteObject: propaga un fallo de S3 como ApiError 502 STORAGE_PROVIDER_ERROR", async () => {
    sendMock.mockRejectedValueOnce(new Error("bucket unreachable"));

    await expect(provider.deleteObject("profile-photos/user-1/photo.jpg")).rejects.toBeInstanceOf(ApiError);
  });
});
