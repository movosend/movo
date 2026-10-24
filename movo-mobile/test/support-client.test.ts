import { ApiError } from "@movo/shared/dist/errors/api-error";
import { resetSupportMock, supportMock, supportMockConfig } from "../src/api/support-mock";
import { isSupportMock, supportClient } from "../src/api/support-client";

describe("support-mock (MOVO-324): reglas del contrato de MOVO-320/321", () => {
  beforeEach(() => {
    supportMockConfig.latencyMs = 0;
    resetSupportMock();
  });

  it("crear una consulta es idempotente por clientMessageId", async () => {
    const first = await supportMock.create({ topic: "payments", body: "Me cobraron dos veces", clientMessageId: "cm-1" });
    const again = await supportMock.create({ topic: "payments", body: "Me cobraron dos veces", clientMessageId: "cm-1" });

    expect(again.conversation.id).toBe(first.conversation.id);
    expect((await supportMock.list()).items.filter((c) => c.topic === "payments")).toHaveLength(2); // la sembrada y la nueva
  });

  it("vincular un envío ajeno se rechaza con SUPPORT_SHIPMENT_NOT_PARTY", async () => {
    await expect(
      supportMock.create({ topic: "shipment", body: "Hola", clientMessageId: "cm-2", shipmentId: "no-es-mio" }),
    ).rejects.toMatchObject({ code: "SUPPORT_SHIPMENT_NOT_PARTY" });
  });

  it("escribir sobre una resuelta la reabre y deja el evento del sistema", async () => {
    await supportMock.sendMessage("conv-1021", { body: "Me siguen llegando avisos", clientMessageId: "cm-3" });

    const page = await supportMock.listMessages("conv-1021");
    expect(page.conversation.status).toBe("open");
    expect(page.items.some((m) => m.kind === "system" && m.body === "Se reabrió la conversación")).toBe(true);
  });

  it("una consulta que esperaba al usuario vuelve a 'abierta' cuando responde", async () => {
    await supportMock.sendMessage("conv-1048", { body: "Acá va", clientMessageId: "cm-4" });
    expect((await supportMock.listMessages("conv-1048")).conversation.status).toBe("open");
  });

  it("el filtro de lenguaje tapa las palabras y marca moderated", async () => {
    const sent = await supportMock.sendMessage("conv-1042", { body: "Esto es una mierda", clientMessageId: "cm-5" });
    expect(sent.moderated).toBe(true);
    expect(sent.body).toBe("Esto es una ******");
  });

  it("reenviar el mismo clientMessageId no duplica el mensaje", async () => {
    await supportMock.sendMessage("conv-1042", { body: "Uno", clientMessageId: "cm-6" });
    await supportMock.sendMessage("conv-1042", { body: "Uno", clientMessageId: "cm-6" });
    const mine = (await supportMock.listMessages("conv-1042")).items.filter((m) => m.clientMessageId === "cm-6");
    expect(mine).toHaveLength(1);
  });

  it("un adjunto se usa una sola vez y uno inexistente es inválido", async () => {
    const { attachmentId } = await supportMock.presignAttachment({ contentType: "image/jpeg", sizeBytes: 10 });

    const sent = await supportMock.sendMessage("conv-1042", { body: "", clientMessageId: "cm-7", attachmentIds: [attachmentId] });
    expect(sent.attachments).toHaveLength(1);
    await expect(
      supportMock.sendMessage("conv-1042", { body: "", clientMessageId: "cm-8", attachmentIds: [attachmentId] }),
    ).rejects.toMatchObject({ code: "SUPPORT_ATTACHMENT_INVALID" });
    await expect(
      supportMock.sendMessage("conv-1042", { body: "x", clientMessageId: "cm-9", attachmentIds: ["inventado"] }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("no acepta más de 4 adjuntos por mensaje", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await supportMock.presignAttachment({ contentType: "image/png", sizeBytes: 1 })).attachmentId);
    await expect(
      supportMock.sendMessage("conv-1042", { body: "fotos", clientMessageId: "cm-10", attachmentIds: ids }),
    ).rejects.toMatchObject({ code: "SUPPORT_ATTACHMENT_INVALID" });
  });

  it("un mensaje vacío y sin adjuntos es inválido", async () => {
    await expect(supportMock.sendMessage("conv-1042", { body: "  ", clientMessageId: "cm-11" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("una consulta que no existe responde SUPPORT_CONVERSATION_NOT_FOUND", async () => {
    await expect(supportMock.listMessages("nada")).rejects.toMatchObject({ code: "SUPPORT_CONVERSATION_NOT_FOUND" });
  });

  it("nunca devuelve notas internas: los tipos de mensaje son solo user, agent y system", async () => {
    const kinds = new Set((await supportMock.listMessages("conv-1042")).items.map((m) => m.kind));
    expect([...kinds].every((k) => ["user", "agent", "system"].includes(k))).toBe(true);
  });

  it("la lista va de la más reciente a la más vieja", async () => {
    const { items } = await supportMock.list();
    const dates = items.map((i) => i.lastActivityAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("supportClient (MOVO-324): elección del mock", () => {
  const original = process.env.EXPO_PUBLIC_SUPPORT_MOCK;
  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPPORT_MOCK = original;
  });

  it("con EXPO_PUBLIC_SUPPORT_MOCK=1 responde desde memoria", async () => {
    supportMockConfig.latencyMs = 0;
    process.env.EXPO_PUBLIC_SUPPORT_MOCK = "1";
    expect(isSupportMock()).toBe(true);
    expect((await supportClient.list()).items.length).toBeGreaterThan(0);
  });

  it("sin la variable no usa el mock", () => {
    delete process.env.EXPO_PUBLIC_SUPPORT_MOCK;
    expect(isSupportMock()).toBe(false);
  });
});
