import { ReportReason } from "@movo/shared/dist/types/user";
import { moderationClient } from "../src/api/moderation-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

/** MOVO-175: contrato de `svc-users` para reportar/bloquear. */
describe("moderationClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reportUser envía POST /users/:id/report con motivo y detalle", async () => {
    await moderationClient.reportUser("user-2", {
      reason: ReportReason.NO_SHOW,
      details: "No vino",
    });
    expect(httpClient.post).toHaveBeenCalledWith("/users/user-2/report", {
      reason: ReportReason.NO_SHOW,
      details: "No vino",
    });
  });

  it("getPendingReport pide GET /users/:id/report", async () => {
    (httpClient.get as jest.Mock).mockResolvedValueOnce(null);
    await expect(moderationClient.getPendingReport("user-2")).resolves.toBeNull();
    expect(httpClient.get).toHaveBeenCalledWith("/users/user-2/report");
  });

  it("addReportEntry envía POST /users/:id/report/entries con texto y fotos", async () => {
    await moderationClient.addReportEntry("user-2", { details: "Me insultó por chat", photoKeys: ["reports/a/1.jpg"] });
    expect(httpClient.post).toHaveBeenCalledWith("/users/user-2/report/entries", {
      details: "Me insultó por chat",
      photoKeys: ["reports/a/1.jpg"],
    });
  });

  it("presignReportPhoto pide POST /users/:id/report/photos/presign como JPEG (MOVO-256)", async () => {
    await moderationClient.presignReportPhoto("user-2", 2048);
    expect(httpClient.post).toHaveBeenCalledWith("/users/user-2/report/photos/presign", {
      contentType: "image/jpeg",
      contentLength: 2048,
    });
  });

  it("blockUser/unblockUser pegan contra /users/:id/block", async () => {
    await moderationClient.blockUser("user-2");
    await moderationClient.unblockUser("user-2");
    expect(httpClient.post).toHaveBeenCalledWith("/users/user-2/block");
    expect(httpClient.delete).toHaveBeenCalledWith("/users/user-2/block");
  });

  it("listBlocked consulta GET /users/me/blocked", async () => {
    const blocked = [
      {
        id: "user-2",
        fullName: "Marta González",
        photoUrl: null,
        blockedAt: "2026-09-25T10:00:00.000Z",
      },
    ];
    (httpClient.get as jest.Mock).mockResolvedValueOnce(blocked);

    await expect(moderationClient.listBlocked()).resolves.toEqual(blocked);
    expect(httpClient.get).toHaveBeenCalledWith("/users/me/blocked");
  });
});
