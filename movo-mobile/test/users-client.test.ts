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

  // MOVO-135 / backend MOVO-133: edición de perfil y cambios verificados.
  it("updateProfile hace PATCH /users/me solo con nombre y apellido", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { patch: jest.fn().mockResolvedValue({ id: "u-1" }) },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    await usersClient.updateProfile({ firstName: "Ana", lastName: "Diaz" });

    expect(httpClient.patch).toHaveBeenCalledWith("/users/me", {
      firstName: "Ana",
      lastName: "Diaz",
    });
  });

  it("requestPhoneChange hace POST /users/me/phone/change/otp con el teléfono nuevo", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        post: jest.fn().mockResolvedValue({ otpId: "otp-1", cooldownSeconds: 60, sent: true }),
      },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    const result = await usersClient.requestPhoneChange("+5493511234567");

    expect(httpClient.post).toHaveBeenCalledWith("/users/me/phone/change/otp", {
      phone: "+5493511234567",
    });
    expect(result.sent).toBe(true);
  });

  it("verifyPhoneChange hace POST /users/me/phone/change/verify con otpId y código", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { post: jest.fn().mockResolvedValue({ id: "u-1" }) },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    await usersClient.verifyPhoneChange({ otpId: "otp-1", code: "123456" });

    expect(httpClient.post).toHaveBeenCalledWith("/users/me/phone/change/verify", {
      otpId: "otp-1",
      code: "123456",
    });
  });

  it("requestEmailChange hace POST /users/me/email/change/otp con el email nuevo", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        post: jest.fn().mockResolvedValue({ otpId: "otp-2", cooldownSeconds: 60, sent: false }),
      },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    const result = await usersClient.requestEmailChange("nuevo@gmail.com");

    expect(httpClient.post).toHaveBeenCalledWith("/users/me/email/change/otp", {
      email: "nuevo@gmail.com",
    });
    // `sent:false` = se reusó un OTP activo, no se mandó un SMS nuevo.
    expect(result.sent).toBe(false);
  });

  it("verifyEmailChange hace POST /users/me/email/change/verify", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { post: jest.fn().mockResolvedValue({ id: "u-1" }) },
    }));
    const { usersClient } = require("../src/api/users-client");
    const { httpClient } = require("../src/api/http-client");

    await usersClient.verifyEmailChange({ otpId: "otp-2", code: "654321" });

    expect(httpClient.post).toHaveBeenCalledWith("/users/me/email/change/verify", {
      otpId: "otp-2",
      code: "654321",
    });
  });
});
