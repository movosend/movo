describe("usersClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("getMyProfile hace GET /users/me", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        get: jest.fn().mockResolvedValue({ id: "u-1", fullName: "Juan Perez" }),
      },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    const profile = await usersClient.getMyProfile();

    expect(httpClient.get).toHaveBeenCalledWith("/users/me");
    expect(profile).toEqual({ id: "u-1", fullName: "Juan Perez" });
  });

  it("getPhotoUploadUrl hace POST /users/me/photo/upload-url con contentType y contentLength", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        post: jest.fn().mockResolvedValue({
          uploadUrl: "https://s3.amazonaws.com/bucket/key",
          objectKey: "profile-photos/u-1/abc.jpg",
          expiresIn: 300,
        }),
      },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    const res = await usersClient.getPhotoUploadUrl({
      contentType: "image/jpeg",
      contentLength: 1024,
    });

    expect(httpClient.post).toHaveBeenCalledWith("/users/me/photo/upload-url", {
      contentType: "image/jpeg",
      contentLength: 1024,
    });
    expect(res.objectKey).toBe("profile-photos/u-1/abc.jpg");
  });

  it("confirmPhoto hace PUT /users/me/photo con objectKey", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        put: jest.fn().mockResolvedValue({
          photoUrl: "https://s3.amazonaws.com/bucket/profile-photos/u-1/abc.jpg",
        }),
      },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    const res = await usersClient.confirmPhoto({
      objectKey: "profile-photos/u-1/abc.jpg",
    });

    expect(httpClient.put).toHaveBeenCalledWith("/users/me/photo", {
      objectKey: "profile-photos/u-1/abc.jpg",
    });
    expect(res.photoUrl).toContain("profile-photos/u-1/abc.jpg");
  });

  it("deletePhoto hace DELETE /users/me/photo", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        delete: jest.fn().mockResolvedValue(undefined),
      },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    await usersClient.deletePhoto();

    expect(httpClient.delete).toHaveBeenCalledWith("/users/me/photo");
  });

  it("uploadPhotoToS3 lee el blob local y hace PUT a la presigned URL con headers exactos sin Authorization", async () => {
    const mockBlob = { size: 2048, type: "image/jpeg" };
    const mockFetch = jest.fn();

    // Primer fetch: lee la uri local
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValue(mockBlob),
    });

    // Segundo fetch: PUT directo a S3
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    globalThis.fetch = mockFetch;

    const { usersClient } = require("../src/api/users-client");

    await usersClient.uploadPhotoToS3(
      "https://s3.amazonaws.com/upload-target",
      "file:///local/photo.jpg",
      "image/jpeg",
      2048,
    );

    expect(mockFetch).toHaveBeenNthCalledWith(1, "file:///local/photo.jpg");
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://s3.amazonaws.com/upload-target",
      {
        method: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": "2048",
        },
        body: mockBlob,
      },
    );
  });

  it("uploadPhotoToS3 lanza error si el PUT a S3 falla", async () => {
    const mockBlob = { size: 1024, type: "image/jpeg" };
    const mockFetch = jest.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValue(mockBlob),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    globalThis.fetch = mockFetch;

    const { usersClient } = require("../src/api/users-client");

    await expect(
      usersClient.uploadPhotoToS3(
        "https://s3.amazonaws.com/upload-target",
        "file:///local/photo.jpg",
        "image/jpeg",
        1024,
      ),
    ).rejects.toThrow(/HTTP 403/);
  });
});
