import { describe, it, expect, vi } from "vitest";
import { FastifyBaseLogger } from "fastify";
import { PushSender, sendTriggerPush } from "../src/modules/notifications/send-trigger-push";

/**
 * MOVO-274: el helper que usan los 4 flujos de push de `svc-users` (KYC, contraseña,
 * email, teléfono). Sin base ni red: el `PushSender` y el logger son fakes.
 */
function createFakes(sendPushToUser = vi.fn().mockResolvedValue(undefined)) {
  const logger = { warn: vi.fn() };
  const notifications: PushSender = { sendPushToUser };
  return { logger, notifications, sendPushToUser };
}

describe("sendTriggerPush (MOVO-274)", () => {
  it("renderiza el copy del trigger, usa su categoría y manda los datos tal cual", async () => {
    const { logger, notifications, sendPushToUser } = createFakes();

    await sendTriggerPush({
      notifications,
      userId: "user-1",
      triggerKey: "accountPasswordChanged",
      params: undefined,
      data: { type: "account_password_changed" },
      logger: logger as unknown as FastifyBaseLogger,
      onErrorContext: { event: "password_changed_push_failed", message: "no se pudo" },
    });

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith("user-1", {
      title: "Cambiaste tu contraseña",
      body: "La contraseña de tu cuenta se cambió. Por seguridad, cerramos tus otras sesiones.",
      category: "account_security",
      data: { type: "account_password_changed" },
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("toma la categoría del propio trigger, no de quien lo llama (kyc)", async () => {
    const { logger, notifications, sendPushToUser } = createFakes();

    await sendTriggerPush({
      notifications,
      userId: "user-1",
      triggerKey: "kycIdentityApproved",
      params: undefined,
      data: { type: "kyc_result" },
      logger: logger as unknown as FastifyBaseLogger,
      onErrorContext: { event: "kyc_push_failed", message: "no se pudo" },
    });

    expect(sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ category: "kyc", title: "Identidad verificada" })
    );
  });

  it("si el envío rechaza, no lanza y loguea un warn con el evento, el usuario y los campos extra", async () => {
    const failure = new Error("expo caído");
    const { logger, notifications } = createFakes(vi.fn().mockRejectedValue(failure));

    await expect(
      sendTriggerPush({
        notifications,
        userId: "user-9",
        triggerKey: "accountEmailChanged",
        params: undefined,
        data: { type: "account_email_changed" },
        logger: logger as unknown as FastifyBaseLogger,
        onErrorContext: {
          event: "email_changed_push_failed",
          message: "no se pudo enviar el push de email cambiado",
          extra: { flow: "email-change" },
        },
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: failure, event: "email_changed_push_failed", userId: "user-9", flow: "email-change" },
      "no se pudo enviar el push de email cambiado"
    );
  });
});
