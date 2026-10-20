import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@movo/shared/src/errors/api-error"

vi.mock("server-only", () => ({}))
import { convId, shipmentId } from "./fixtures"
import {
  mockAgents,
  mockContext,
  mockCounts,
  mockCreateAttachment,
  mockEvents,
  mockList,
  mockMessages,
  mockMarkRead,
  mockPatch,
  mockSend,
  mockSetStatus,
  mockStoreUpload,
  type MockActor,
} from "./mock"

const ME: MockActor = { adminId: "11111111-1111-4111-8111-111111111111", adminName: "Tomás Ferreyra" }
const C1042 = convId(1042)
const C1045 = convId(1045)
const OWN = convId(1050)
const msgId = () => crypto.randomUUID()

beforeEach(() => {
  vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
  vi.stubEnv("MOVO_ADMIN_MOCK_SIMULATE", "0")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("bandeja", () => {
  it("abiertas: primero la prioridad y, a igual prioridad, la que más espera", async () => {
    const page = await mockList({ status: "open" }, ME)
    const prios = page.items.map((i) => i.priority)
    expect(prios).toEqual([...prios].sort((a, b) => "urgent,high,normal,low".indexOf(a) - "urgent,high,normal,low".indexOf(b)))
    const urgent = page.items.filter((i) => i.priority === "urgent")
    expect(urgent[0].waitMinutes).toBeGreaterThanOrEqual(urgent[1].waitMinutes)
  })

  it("filtra por asignación y busca por nombre, SOP, envío y texto", async () => {
    expect((await mockList({ status: "open", assignee: "none" }, ME)).items.every((i) => i.assignee === null)).toBe(true)
    expect((await mockList({ status: "open", assignee: "me" }, ME)).items.every((i) => i.assignee?.id === ME.adminId)).toBe(true)
    expect((await mockList({ status: "open", q: "carolina" }, ME)).items.map((i) => i.code)).toEqual(["SOP-1042"])
    expect((await mockList({ status: "open", q: "sop-1045" }, ME)).items).toHaveLength(1)
    expect((await mockList({ status: "open", q: "#MOVO-48162" }, ME)).items.length).toBeGreaterThan(0)
    expect((await mockList({ status: "open", q: "lámpara" }, ME)).items).toHaveLength(1)
  })

  it("cuenta por estado y por asignación", async () => {
    const counts = await mockCounts({ status: "open" }, ME)
    expect(counts.byOwner.all).toBe(counts.byOwner.mine + counts.byOwner.none + (counts.byOwner.all - counts.byOwner.mine - counts.byOwner.none))
    expect(counts.byStatus.resolved).toBe(2)
    expect(counts.unreadTotal).toBeGreaterThan(0)
  })

  it("la vista previa del último mensaje ignora las notas internas", async () => {
    const row = (await mockList({ status: "open", q: "SOP-1042" }, ME)).items[0]
    expect(row.lastMessage?.from).toBe("user")
    expect(row.lastMessage?.body).toContain("Cuánto tarda")
  })

  it("los mensajes vienen del más reciente al más viejo e incluyen notas y eventos", async () => {
    const page = await mockMessages(C1042, undefined, ME)
    const kinds = new Set(page.items.map((m) => m.kind))
    expect(kinds).toEqual(new Set(["user", "agent", "internal_note", "system"]))
    expect(page.items[0].createdAt >= page.items[1].createdAt).toBe(true)
  })
})

describe("escrituras", () => {
  it("responder pasa a 'esperando al usuario', asigna con evento y no duplica por clientMessageId", async () => {
    const clientMessageId = msgId()
    const first = await mockSend(C1045, { body: "Hola Diego", clientMessageId }, ME)
    const again = await mockSend(C1045, { body: "Hola Diego", clientMessageId }, ME)
    expect(again.id).toBe(first.id)
    const row = (await mockList({ status: "awaiting_user", q: "SOP-1045" }, ME)).items[0]
    expect(row.assignee?.id).toBe(ME.adminId)
    const msgs = (await mockMessages(C1045, undefined, ME)).items
    expect(msgs.filter((m) => m.kind === "agent" && m.body === "Hola Diego")).toHaveLength(1)
    expect(msgs.some((m) => m.kind === "system" && m.body.includes("tomó la conversación"))).toBe(true)
  })

  it("una nota interna no cambia el estado ni genera evento de asignación", async () => {
    const before = (await mockList({ status: "open", q: "SOP-1039" }, ME)).items[0]
    await mockSend(convId(1039), { body: "Revisar KYC", clientMessageId: msgId(), internal: true }, ME)
    const after = (await mockList({ status: "open", q: "SOP-1039" }, ME)).items[0]
    expect(after.status).toBe(before.status)
    expect(after.assignee).toBeNull()
    expect(after.lastMessage?.body).toBe(before.lastMessage?.body)
  })

  it("resolver y reabrir dejan eventos; responder sobre una resuelta la reabre", async () => {
    await mockSetStatus(C1042, "resolve", ME)
    expect((await mockList({ status: "resolved", q: "SOP-1042" }, ME)).items).toHaveLength(1)
    await mockSetStatus(C1042, "reopen", ME)
    const open = (await mockList({ status: "open", q: "SOP-1042" }, ME)).items
    expect(open.some((i) => i.code === "SOP-1042")).toBe(true)
    const resolved = convId(1028)
    await mockSend(resolved, { body: "Volvemos", clientMessageId: msgId() }, ME)
    const msgs = (await mockMessages(resolved, undefined, ME)).items
    expect(msgs.some((m) => m.kind === "system" && m.body.includes("reabrió"))).toBe(true)
  })

  it("asignar, priorizar y cambiar tema dejan evento; las etiquetas no", async () => {
    const id = convId(1036)
    const before = (await mockMessages(id, undefined, ME)).items.length
    await mockPatch(id, { priority: "high", topic: "payments", assignedTo: null }, ME)
    await mockPatch(id, { tags: ["VIP", "Cobro"] }, ME)
    const msgs = (await mockMessages(id, undefined, ME)).items
    expect(msgs.length - before).toBe(3)
    expect(msgs.map((m) => (m.kind === "system" ? m.body : "")).join("|")).toContain("Prioridad: alta")
  })

  it("vincula solo envíos del usuario", async () => {
    const id = convId(1033)
    await expect(mockPatch(id, { shipmentId: shipmentId("MOVO-99999") }, ME)).rejects.toMatchObject({ statusCode: 422, code: "SUPPORT_SHIPMENT_NOT_PARTY" })
    const done = await mockPatch(id, { shipmentId: shipmentId("MOVO-48224") }, ME)
    expect(done.shipment?.code).toBe("MOVO-48224")
    expect((await mockPatch(id, { shipmentId: null }, ME)).shipment).toBeNull()
  })

  it("rechaza escrituras sobre una consulta propia con 403 y deja leerla", async () => {
    await expect(mockSend(OWN, { body: "x", clientMessageId: msgId() }, ME)).rejects.toMatchObject({ statusCode: 403, code: "ADMIN_CONFLICT_OF_INTEREST" })
    await expect(mockPatch(OWN, { priority: "low" }, ME)).rejects.toBeInstanceOf(ApiError)
    await expect(mockSetStatus(OWN, "resolve", ME)).rejects.toMatchObject({ statusCode: 403 })
    expect((await mockMessages(OWN, undefined, ME)).items.length).toBeGreaterThan(0)
  })

  it("marcar como leída resetea el contador", async () => {
    await mockMarkRead(convId(1039), ME)
    const rows = (await mockList({ status: "open", q: "SOP-1039" }, ME)).items
    expect(rows.find((i) => i.code === "SOP-1039")?.unread).toBe(0)
  })
})

describe("adjuntos", () => {
  it("valida tipo y tamaño al pedir la URL", async () => {
    await expect(mockCreateAttachment({ conversationId: C1042, contentType: "application/pdf" as never, sizeBytes: 10 }, ME)).rejects.toMatchObject({ statusCode: 422 })
    await expect(mockCreateAttachment({ conversationId: C1042, contentType: "image/png", sizeBytes: 6 * 1024 * 1024 }, ME)).rejects.toMatchObject({ statusCode: 422 })
  })

  it("exige subir el objeto, con el tipo y tamaño declarados, y no se reutiliza", async () => {
    const created = await mockCreateAttachment({ conversationId: C1042, contentType: "image/png", sizeBytes: 4 }, ME)
    await expect(mockSend(C1042, { body: "", clientMessageId: msgId(), attachmentIds: [created.attachmentId] }, ME)).rejects.toMatchObject({ code: "SUPPORT_ATTACHMENT_INVALID" })
    expect(mockStoreUpload(created.attachmentId, "image/png", Buffer.from([1, 2, 3, 4]))).toBe(true)
    const sent = await mockSend(C1042, { body: "", clientMessageId: msgId(), attachmentIds: [created.attachmentId] }, ME)
    expect(sent.kind === "agent" && sent.attachments).toHaveLength(1)
    await expect(mockSend(C1042, { body: "", clientMessageId: msgId(), attachmentIds: [created.attachmentId] }, ME)).rejects.toMatchObject({ code: "SUPPORT_ATTACHMENT_INVALID" })
  })

  it("no acepta más de 4 por mensaje", async () => {
    await expect(mockSend(C1042, { body: "x", clientMessageId: msgId(), attachmentIds: ["a", "b", "c", "d", "e"] }, ME)).rejects.toMatchObject({ code: "SUPPORT_ATTACHMENT_INVALID" })
  })
})

describe("contexto y agentes", () => {
  it("devuelve perfil, insignias, envíos y consultas anteriores", async () => {
    const ctx = await mockContext(C1042, ME)
    expect(ctx.profile.fullName).toBe("Carolina Sánchez")
    expect(ctx.badges).toContain("kyc_approved")
    expect(ctx.recentShipments.length).toBeGreaterThan(0)
    expect(ctx.otherConversations.length).toBeGreaterThan(0)
  })

  it("falla con 502 solo la primera vez con MOVO_ADMIN_MOCK_FAIL=context", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_FAIL", "context")
    await expect(mockContext(convId(1040), ME)).rejects.toMatchObject({ statusCode: 502 })
    await expect(mockContext(convId(1040), ME)).resolves.toBeTruthy()
  })

  it("lista agentes con su carga de consultas activas", async () => {
    const agents = await mockAgents(ME)
    expect(agents.map((a) => a.fullName)).toContain("Lucía Bustos")
    expect(agents.find((a) => a.id === ME.adminId)?.activeCount).toBeGreaterThan(0)
  })
})

describe("eventos para el polling", () => {
  it("entrega solo lo posterior al cursor", async () => {
    const start = await mockEvents(undefined, ME)
    await mockSend(convId(1040), { body: "Hola", clientMessageId: msgId() }, ME)
    const page = await mockEvents(start.cursor, ME)
    expect(page.events.map((e) => e.type)).toContain("support_message")
    expect(page.events.every((e) => Number(e.cursor) > Number(start.cursor))).toBe(true)
    expect((await mockEvents(page.cursor, ME)).events).toHaveLength(0)
  })
})
