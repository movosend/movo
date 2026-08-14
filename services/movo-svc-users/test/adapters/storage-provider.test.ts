import { describe, it, expect } from "vitest";
import { createStorageProvider } from "../../src/adapters/storage-provider";

describe("createStorageProvider (factory, MOVO-97)", () => {
  it("devuelve el MockStorageProvider por default (STORAGE_PROVIDER=mock)", async () => {
    const provider = createStorageProvider({ STORAGE_PROVIDER: "mock" });

    const { uploadUrl } = await provider.createUploadUrl({
      key: "profile-photos/user-1/a.jpg",
      contentType: "image/jpeg",
      contentLength: 1024,
    });
    expect(uploadUrl).toContain("profile-photos/user-1/a.jpg");
  });

  it("falla rápido al arrancar si STORAGE_PROVIDER=s3 sin S3_BUCKET_NAME/S3_REGION", () => {
    expect(() => createStorageProvider({ STORAGE_PROVIDER: "s3" })).toThrow(
      "STORAGE_PROVIDER=s3 requiere S3_BUCKET_NAME y S3_REGION"
    );
    expect(() => createStorageProvider({ STORAGE_PROVIDER: "s3", S3_BUCKET_NAME: "bucket" })).toThrow();
    expect(() => createStorageProvider({ STORAGE_PROVIDER: "s3", S3_REGION: "us-east-1" })).toThrow();
  });

  it("con S3_BUCKET_NAME/S3_REGION completos, arma el provider real sin tirar", () => {
    expect(() =>
      createStorageProvider({ STORAGE_PROVIDER: "s3", S3_BUCKET_NAME: "movo-dev-bucket", S3_REGION: "us-east-1" })
    ).not.toThrow();
  });
});
