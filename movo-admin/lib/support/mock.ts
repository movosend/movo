import "server-only"
import { randomUUID } from "node:crypto"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
  SUPPORT_ATTACHMENT_TYPES,
  SUPPORT_ERROR,
  SUPPORT_LIST_PAGE_SIZE,
  SUPPORT_MESSAGES_PAGE_SIZE,
  SUPPORT_MESSAGE_MAX_LENGTH,
  type SupportAgent,
  type SupportAgentRef,
  type SupportAttachment,
  type SupportAttachmentCreateBody,
  type SupportAttachmentCreateResult,
  type SupportConversation,
  type SupportConversationRow,
  type SupportCounts,
  type SupportCountsQuery,
  type SupportEvent,
  type SupportEventsPage,
  type SupportListPage,
  type SupportListQuery,
  type SupportMessage,
  type SupportMessagesPage,
  type SupportPatchBody,
  type SupportPriority,
  type SupportRealtimeTicket,
  type SupportSendBody,
  type SupportStatus,
  type SupportTag,
  type SupportTopic,
  type SupportUserContext,
} from "@movo/shared/src/types/admin-support"
import { mockEnabled } from "@/lib/users/mock"
import {
  AGENT_NAMES,
  ME,
  NEWCOMER,
  OWN,
  SEED,
  agentId,
  convId,
  shipmentId,
  userId,
  type FixtureConversation,
  type FixtureMessage,
} from "./fixtures"
import { PRIORITY_LABEL, TOPIC_LABEL } from "./labels"

export { mockEnabled }

/** Quién actúa: el admin de la sesión. El mock lo usa como "Vos" (`ME` en los fixtures). */
export interface MockActor {
  adminId: string
  adminName: string
}

/**
 * Modo fixtures de la bandeja (MOVO-323): `MOVO_ADMIN_MOCK=1` reemplaza la capa de datos de
 * Soporte mientras `svc-admin` no tenga las rutas de MOVO-322. Todo vive en la memoria del proceso
 * (se pierde al reiniciar el server) y hace de servidor del WS y del polling.
 *
 * - `MOVO_ADMIN_MOCK_FAIL=context` hace fallar esa llamada con 502 la primera vez (`context!`,
 *   siempre). Claves: `list`, `counts`, `thread`, `context`, `agents`, `send`, `write`, `ws`
 *   (el ticket del WS falla y el panel cae a polling).
 * - `MOVO_ADMIN_MOCK_SIMULATE=0` apaga la consulta que entra sola a los 16 s y las respuestas.
 * - `MOVO_ADMIN_MOCK_LATENCY_MS` es la demora base (default 350 ms).
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const base = () => {
  const n = Number(process.env.MOVO_ADMIN_MOCK_LATENCY_MS)
  return Number.isFinite(n) && n >= 0 ? n : 350
}
const simulate = () => process.env.MOVO_ADMIN_MOCK_SIMULATE !== "0"

const failedOnce = new Set<string>()
function shouldFail(key: string): boolean {
  const spec = (process.env.MOVO_ADMIN_MOCK_FAIL ?? "")
    .split(",")
    .map((s) => s.trim())
  if (spec.includes(`${key}!`)) return true
  if (!spec.includes(key)) return false
  if (failedOnce.has(key)) return false
  failedOnce.add(key)
  return true
}
const unavailable = () =>
  new ApiError(502, "SUPPORT_SERVICE_UNAVAILABLE", "El servicio no respondió.")
const notFound = () =>
  new ApiError(404, SUPPORT_ERROR.NOT_FOUND, "No existe la consulta.")
const conflict = () =>
  new ApiError(
    403,
    SUPPORT_ERROR.CONFLICT,
    "No podés modificar una consulta tuya."
  )
const invalidAttachment = (message = "Adjunto inválido.") =>
  new ApiError(422, SUPPORT_ERROR.ATTACHMENT_INVALID, message)

interface Rec {
  id: string
  num: number
  topic: SupportTopic
  priority: SupportPriority
  status: SupportStatus
  assigneeId: string | null
  tags: SupportTag[]
  shipmentCode: string | null
  unread: number
  userId: string
  fx: FixtureConversation
  createdAt: number
  resolvedAt: number | null
  waitAt: number | null
  lastActivityAt: number
  messages: SupportMessage[]
  replies: string[]
}

interface Upload {
  id: string
  conversationId: string
  contentType: string
  sizeBytes: number
  bytes: Buffer | null
  used: boolean
}

interface Store {
  meId: string
  meName: string
  recs: Map<string, Rec>
  uploads: Map<string, Upload>
  events: SupportEvent[]
  seq: number
  nextNum: number
  seeded: boolean
  timers: ReturnType<typeof setTimeout>[]
}

const globals = globalThis as unknown as { __movoSupportMock?: Store }

const ago = (min: number, now: number) => now - min * 60_000
const iso = (ms: number) => new Date(ms).toISOString()

function agentRef(store: Store, key: string): SupportAgentRef {
  if (key === ME) return { id: store.meId, fullName: store.meName }
  return { id: agentId(key), fullName: AGENT_NAMES[key] ?? key }
}

function build(store: Store, fx: FixtureConversation, now: number): Rec {
  const id = convId(fx.num)
  const own = fx.num === OWN.num
  const uid = own ? store.meId : userId(fx.user.name)
  const messages: SupportMessage[] = fx.msgs.map((m, i) =>
    toMessage(store, id, `${id}-m${i}`, m, now)
  )
  const last = fx.msgs[fx.msgs.length - 1]
  const lastAt = ago(last?.ago ?? 0, now)
  const waitAt = fx.status === "open" && fx.wait > 0 ? ago(fx.wait, now) : null
  return {
    id,
    num: fx.num,
    topic: fx.topic,
    priority: fx.priority,
    status: fx.status,
    assigneeId: fx.agent ? agentRef(store, fx.agent).id : null,
    tags: fx.tags,
    shipmentCode: fx.link,
    unread: fx.unread,
    userId: uid,
    fx: own
      ? { ...fx, user: { ...fx.user, name: store.meName, email: "" } }
      : fx,
    createdAt: ago(fx.msgs[0]?.ago ?? 0, now),
    resolvedAt: fx.status === "resolved" ? lastAt : null,
    waitAt,
    lastActivityAt: lastAt,
    messages,
    replies: [...fx.replies],
  }
}

function imageAttachment(
  convIdValue: string,
  key: string,
  size: number
): SupportAttachment[] {
  return Array.from({ length: size }, (_, n) => ({
    id: `${convIdValue}-img${key}-${n}`,
    contentType: "image/png" as const,
    width: n % 2 ? 480 : 640,
    height: n % 2 ? 640 : 480,
    url: `/api/support/mock-image/${convIdValue}-img${key}-${n}`,
  }))
}

function toMessage(
  store: Store,
  conversationId: string,
  id: string,
  m: FixtureMessage,
  now: number
): SupportMessage {
  const createdAt = iso(ago(m.ago, now))
  switch (m.k) {
    case "u":
      return {
        kind: "user",
        id,
        conversationId,
        createdAt,
        body: m.b,
        attachments: m.img ? imageAttachment(conversationId, id, m.img) : [],
      }
    case "a":
      return {
        kind: "agent",
        id,
        conversationId,
        createdAt,
        body: m.b,
        attachments: m.img ? imageAttachment(conversationId, id, m.img) : [],
        author: agentRef(store, m.by),
      }
    case "note":
      return {
        kind: "internal_note",
        id,
        conversationId,
        createdAt,
        body: m.b,
        attachments: [],
        author: agentRef(store, m.by),
      }
    case "sys":
      return {
        kind: "system",
        id,
        conversationId,
        createdAt,
        body: m.b,
        actor: m.by ? agentRef(store, m.by) : null,
      }
  }
}

function getStore(actor: MockActor): Store {
  let store = globals.__movoSupportMock
  if (!store) {
    store = {
      meId: actor.adminId,
      meName: actor.adminName,
      recs: new Map(),
      uploads: new Map(),
      events: [],
      seq: 0,
      nextNum: 1049,
      seeded: false,
      timers: [],
    }
    globals.__movoSupportMock = store
  }
  if (!store.seeded) {
    store.seeded = true
    const now = Date.now()
    for (const fx of [...SEED, OWN])
      store.recs.set(convId(fx.num), build(store, fx, now))
    if (simulate()) store.timers.push(setTimeout(() => incoming(store), 16_000))
  }
  return store
}

const rank: Record<SupportPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

function waitMinutes(rec: Rec): number {
  return rec.waitAt && rec.status === "open"
    ? Math.max(0, Math.round((Date.now() - rec.waitAt) / 60_000))
    : 0
}

function lastVisible(rec: Rec) {
  for (let i = rec.messages.length - 1; i >= 0; i--) {
    const m = rec.messages[i]
    if (m.kind === "user")
      return {
        from: "user" as const,
        authorId: null,
        authorName: rec.fx.user.name,
        body: m.body,
        hasAttachments: m.attachments.length > 0,
        createdAt: m.createdAt,
      }
    if (m.kind === "agent")
      return {
        from: "agent" as const,
        authorId: m.author.id,
        authorName: m.author.fullName,
        body: m.body,
        hasAttachments: m.attachments.length > 0,
        createdAt: m.createdAt,
      }
  }
  return null
}

function toRow(store: Store, rec: Rec): SupportConversationRow {
  const assignee =
    rec.assigneeId === null
      ? null
      : (agents(store).find((a) => a.id === rec.assigneeId) ?? null)
  return {
    id: rec.id,
    code: `SOP-${rec.num}`,
    user: {
      id: rec.userId,
      fullName: rec.fx.user.name,
      role: rec.fx.user.role,
    },
    topic: rec.topic,
    priority: rec.priority,
    status: rec.status,
    assignee: assignee
      ? { id: assignee.id, fullName: assignee.fullName }
      : null,
    unread: rec.unread,
    lastMessage: lastVisible(rec),
    waitMinutes: waitMinutes(rec),
    shipment: rec.shipmentCode
      ? { id: shipmentId(rec.shipmentCode), code: rec.shipmentCode }
      : null,
    tags: rec.tags,
    lastActivityAt: iso(rec.lastActivityAt),
  }
}

function agents(store: Store): SupportAgentRef[] {
  return [ME, "lb", "mr", "sp"].map((k) => agentRef(store, k))
}

function matches(rec: Rec, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^#/, "")
  if (!needle) return true
  const hay = [
    rec.fx.user.name,
    `SOP-${rec.num}`,
    rec.shipmentCode ?? "",
    ...rec.messages.map((m) => ("body" in m ? m.body : "")),
  ]
    .join(" ")
    .toLowerCase()
  return hay.includes(needle)
}

function ownerOk(store: Store, rec: Rec, assignee?: string): boolean {
  if (!assignee) return true
  if (assignee === "me") return rec.assigneeId === store.meId
  if (assignee === "none") return rec.assigneeId === null
  return rec.assigneeId === assignee
}

function emit(store: Store, event: DistributiveOmit<SupportEvent, "cursor">) {
  const cursor = String(++store.seq)
  store.events.push({ ...event, cursor } as SupportEvent)
  if (store.events.length > 500) store.events.shift()
}
type DistributiveOmit<T, K extends keyof never> = T extends unknown
  ? Omit<T, K>
  : never

function emitCounts(store: Store) {
  emit(store, {
    type: "counts_updated",
    counts: computeCounts(store, { status: "open" }),
  })
}

function pushMessage(store: Store, rec: Rec, message: SupportMessage) {
  rec.messages.push(message)
  rec.lastActivityAt = Date.now()
  emit(store, {
    type: "support_message",
    conversationId: rec.id,
    message,
    conversation: toRow(store, rec),
  })
}

function sys(
  store: Store,
  rec: Rec,
  body: string,
  actor: SupportAgentRef | null
) {
  pushMessage(store, rec, {
    kind: "system",
    id: randomUUID(),
    conversationId: rec.id,
    createdAt: iso(Date.now()),
    body,
    actor,
  })
}

function touched(store: Store, rec: Rec) {
  emit(store, { type: "conversation_updated", conversation: toRow(store, rec) })
  emitCounts(store)
}

function incoming(store: Store) {
  const now = Date.now()
  const num = store.nextNum++
  const fx: FixtureConversation = {
    ...NEWCOMER,
    num,
    msgs: [{ ...NEWCOMER.msgs[0] }],
  }
  const rec = build(store, fx, now)
  rec.waitAt = now
  store.recs.set(rec.id, rec)
  emit(store, { type: "conversation_created", conversation: toRow(store, rec) })
  emitCounts(store)
}

function userReply(store: Store, rec: Rec) {
  if (!simulate() || rec.replies.length === 0) return
  store.timers.push(
    setTimeout(() => {
      const current = store.recs.get(rec.id)
      const body = current?.replies.shift()
      if (!current || !body || current.status === "resolved") return
      current.status = "open"
      current.waitAt = Date.now()
      current.unread += 1
      pushMessage(store, current, {
        kind: "user",
        id: randomUUID(),
        conversationId: current.id,
        createdAt: iso(Date.now()),
        body,
        attachments: [],
      })
      touched(store, current)
    }, 6_000)
  )
}

function compute(store: Store, query: SupportCountsQuery) {
  const all = [...store.recs.values()]
  const q = query.q ?? ""
  const byStatus: Record<SupportStatus, number> = {
    open: 0,
    awaiting_user: 0,
    resolved: 0,
  }
  for (const r of all)
    if (ownerOk(store, r, query.assignee) && matches(r, q)) byStatus[r.status]++
  const inState = all.filter((r) => r.status === query.status && matches(r, q))
  return {
    byStatus,
    byOwner: {
      all: inState.length,
      mine: inState.filter((r) => r.assigneeId === store.meId).length,
      none: inState.filter((r) => r.assigneeId === null).length,
    },
  }
}

function computeCounts(store: Store, query: SupportCountsQuery): SupportCounts {
  return {
    ...compute(store, query),
    unreadTotal: [...store.recs.values()].reduce((n, r) => n + r.unread, 0),
  }
}

function sorted(store: Store, query: SupportListQuery): Rec[] {
  const list = [...store.recs.values()].filter(
    (r) =>
      r.status === query.status &&
      ownerOk(store, r, query.assignee) &&
      matches(r, query.q ?? "")
  )
  return list.sort((a, b) =>
    query.status === "resolved"
      ? b.lastActivityAt - a.lastActivityAt
      : rank[a.priority] - rank[b.priority] ||
        (a.waitAt ?? Date.now()) - (b.waitAt ?? Date.now())
  )
}

const need = (store: Store, id: string): Rec => {
  const rec = store.recs.get(id)
  if (!rec) throw notFound()
  return rec
}
const guardWrite = (store: Store, rec: Rec) => {
  if (rec.userId === store.meId) throw conflict()
  if (shouldFail("write")) throw unavailable()
}

// --- lecturas -----------------------------------------------------------------------------

export async function mockList(
  query: SupportListQuery,
  actor: MockActor
): Promise<SupportListPage> {
  await sleep(base() * 0.7)
  if (shouldFail("list")) throw unavailable()
  const store = getStore(actor)
  const all = sorted(store, query)
  const start = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0
  const items = all.slice(start, start + SUPPORT_LIST_PAGE_SIZE)
  const end = start + items.length
  return {
    items: items.map((r) => toRow(store, r)),
    nextCursor: end < all.length ? String(end) : null,
  }
}

export async function mockCounts(
  query: SupportCountsQuery,
  actor: MockActor
): Promise<SupportCounts> {
  await sleep(base() * 0.3)
  if (shouldFail("counts")) throw unavailable()
  return computeCounts(getStore(actor), query)
}

export async function mockGetConversation(
  id: string,
  actor: MockActor
): Promise<SupportConversation> {
  await sleep(base() * 0.5)
  if (shouldFail("thread")) throw unavailable()
  const store = getStore(actor)
  const rec = need(store, id)
  return {
    ...toRow(store, rec),
    createdAt: iso(rec.createdAt),
    resolvedAt: rec.resolvedAt ? iso(rec.resolvedAt) : null,
  }
}

export async function mockMessages(
  id: string,
  cursor: string | undefined,
  actor: MockActor
): Promise<SupportMessagesPage> {
  await sleep(base() * 0.8)
  if (shouldFail("thread")) throw unavailable()
  const store = getStore(actor)
  const rec = need(store, id)
  const newest = [...rec.messages].reverse()
  const start = cursor ? Math.max(0, Number(cursor) || 0) : 0
  const items = newest.slice(start, start + SUPPORT_MESSAGES_PAGE_SIZE)
  const end = start + items.length
  return { items, nextCursor: end < newest.length ? String(end) : null }
}

export async function mockContext(
  id: string,
  actor: MockActor
): Promise<SupportUserContext> {
  await sleep(base() * 1.6)
  if (shouldFail("context")) throw unavailable()
  const store = getStore(actor)
  const rec = need(store, id)
  const user = rec.fx.user
  const now = Date.now()
  const others = [...store.recs.values()]
    .filter((r) => r.userId === rec.userId && r.id !== rec.id)
    .map((r) => ({
      conversationId: r.id,
      code: `SOP-${r.num}`,
      topic: r.topic,
      status: r.status,
      createdAt: iso(r.createdAt),
    }))
  const past = user.history.map((h, i) => ({
    conversationId: convId(rec.num * 100 + i),
    code: `SOP-${900 + rec.num - i * 7}`,
    topic: h.topic,
    status: h.status,
    createdAt: iso(now - h.daysAgo * 86_400_000),
  }))
  return {
    profile: {
      id: rec.userId,
      fullName: user.name,
      roles: [user.role],
      memberSince: iso(now - user.monthsAgo * 30 * 86_400_000),
      email: user.email,
      phone: user.phone,
      ratingAverage: user.rating,
      ratingCount: user.ratingCount,
      shipmentCount: user.shipmentCount,
      tripCount: user.tripCount,
    },
    badges: user.badges,
    recentShipments: user.ships.map((s, i) => ({
      id: shipmentId(s.code),
      code: s.code,
      status: s.statusLabel,
      statusLabel: s.statusLabel,
      tone: s.tone,
      route: s.route,
      createdAt: iso(now - (i + 1) * 3 * 86_400_000),
    })),
    otherConversations: [...others, ...past],
  }
}

export async function mockAgents(actor: MockActor): Promise<SupportAgent[]> {
  await sleep(base() * 0.3)
  if (shouldFail("agents")) throw unavailable()
  const store = getStore(actor)
  return agents(store).map((a) => ({
    ...a,
    activeCount: [...store.recs.values()].filter(
      (r) => r.assigneeId === a.id && r.status !== "resolved"
    ).length,
  }))
}

// --- escrituras ----------------------------------------------------------------------------

export async function mockSend(
  id: string,
  body: SupportSendBody,
  actor: MockActor
): Promise<SupportMessage> {
  await sleep(base() * 0.5)
  if (shouldFail("send")) throw unavailable()
  const store = getStore(actor)
  const rec = need(store, id)
  guardWrite(store, rec)
  const duplicate = rec.messages.find(
    (m) => "clientMessageId" in m && m.clientMessageId === body.clientMessageId
  )
  if (duplicate) return duplicate
  const text = body.body.trim()
  const ids = body.attachmentIds ?? []
  if (!text && ids.length === 0)
    throw new ApiError(422, "VALIDATION_FAILED", "Mensaje vacío.")
  if (text.length > SUPPORT_MESSAGE_MAX_LENGTH)
    throw new ApiError(422, "VALIDATION_FAILED", "Mensaje demasiado largo.")
  if (ids.length > SUPPORT_ATTACHMENT_MAX_PER_MESSAGE)
    throw invalidAttachment("Demasiados adjuntos.")
  const files = ids.map((attachmentId) => {
    const up = store.uploads.get(attachmentId)
    if (
      !up ||
      up.used ||
      up.conversationId !== id ||
      !up.bytes ||
      up.bytes.length !== up.sizeBytes
    )
      throw invalidAttachment()
    return up
  })
  for (const up of files) up.used = true
  const attachments: SupportAttachment[] = files.map((up) => ({
    id: up.id,
    contentType: up.contentType as SupportAttachment["contentType"],
    url: `/api/support/mock-image/${up.id}`,
  }))
  const me = agentRef(store, ME)
  const common = {
    id: randomUUID(),
    conversationId: id,
    createdAt: iso(Date.now()),
    clientMessageId: body.clientMessageId,
    body: text,
    attachments,
    author: me,
  }
  const message: SupportMessage = body.internal
    ? { kind: "internal_note", ...common }
    : { kind: "agent", ...common }
  if (body.internal) {
    pushMessage(store, rec, message)
    touched(store, rec)
    return message
  }
  const reopened = rec.status === "resolved"
  pushMessage(store, rec, message)
  rec.status = "awaiting_user"
  rec.waitAt = null
  rec.resolvedAt = null
  if (!rec.assigneeId) {
    rec.assigneeId = store.meId
    sys(store, rec, `${me.fullName} tomó la conversación`, me)
  }
  if (reopened) sys(store, rec, `${me.fullName} reabrió la conversación`, me)
  touched(store, rec)
  userReply(store, rec)
  return message
}

export async function mockPatch(
  id: string,
  body: SupportPatchBody,
  actor: MockActor
): Promise<SupportConversation> {
  await sleep(base() * 0.4)
  const store = getStore(actor)
  const rec = need(store, id)
  guardWrite(store, rec)
  const me = agentRef(store, ME)
  if (body.assignedTo !== undefined && body.assignedTo !== rec.assigneeId) {
    const target =
      body.assignedTo === null
        ? null
        : (agents(store).find((a) => a.id === body.assignedTo) ?? null)
    if (body.assignedTo !== null && !target)
      throw new ApiError(422, "VALIDATION_FAILED", "Agente inexistente.")
    rec.assigneeId = target?.id ?? null
    sys(
      store,
      rec,
      target === null
        ? `${me.fullName} dejó la conversación sin asignar`
        : target.id === store.meId
          ? `${me.fullName} tomó la conversación`
          : `${me.fullName} asignó la conversación a ${target.fullName}`,
      me
    )
  }
  if (body.priority && body.priority !== rec.priority) {
    rec.priority = body.priority
    sys(
      store,
      rec,
      `Prioridad: ${PRIORITY_LABEL[body.priority].toLowerCase()}`,
      me
    )
  }
  if (body.topic && body.topic !== rec.topic) {
    rec.topic = body.topic
    sys(store, rec, `Tema: ${TOPIC_LABEL[body.topic].toLowerCase()}`, me)
  }
  if (body.tags) rec.tags = [...new Set(body.tags)]
  if (body.shipmentId !== undefined) {
    if (body.shipmentId === null) {
      if (rec.shipmentCode) sys(store, rec, "Envío desvinculado", me)
      rec.shipmentCode = null
    } else {
      const ship = rec.fx.user.ships.find(
        (s) => shipmentId(s.code) === body.shipmentId
      )
      if (!ship)
        throw new ApiError(
          422,
          SUPPORT_ERROR.SHIPMENT_NOT_PARTY,
          "El usuario no es parte de ese envío."
        )
      if (ship.code !== rec.shipmentCode) {
        rec.shipmentCode = ship.code
        sys(store, rec, `Vinculada a #${ship.code}`, me)
      }
    }
  }
  touched(store, rec)
  return {
    ...toRow(store, rec),
    createdAt: iso(rec.createdAt),
    resolvedAt: rec.resolvedAt ? iso(rec.resolvedAt) : null,
  }
}

export async function mockSetStatus(
  id: string,
  action: "resolve" | "reopen",
  actor: MockActor
): Promise<SupportConversation> {
  await sleep(base() * 0.4)
  const store = getStore(actor)
  const rec = need(store, id)
  guardWrite(store, rec)
  const me = agentRef(store, ME)
  if (action === "resolve" && rec.status !== "resolved") {
    rec.status = "resolved"
    rec.waitAt = null
    rec.resolvedAt = Date.now()
    if (!rec.assigneeId) rec.assigneeId = store.meId
    sys(store, rec, `${me.fullName} resolvió la conversación`, me)
  } else if (action === "reopen" && rec.status === "resolved") {
    rec.status = "open"
    rec.waitAt = Date.now()
    rec.resolvedAt = null
    sys(store, rec, `${me.fullName} reabrió la conversación`, me)
  }
  touched(store, rec)
  return {
    ...toRow(store, rec),
    createdAt: iso(rec.createdAt),
    resolvedAt: rec.resolvedAt ? iso(rec.resolvedAt) : null,
  }
}

/** Marcar como leída es una lectura: no pasa por el conflicto de interés ni la bitácora. */
export async function mockMarkRead(
  id: string,
  actor: MockActor
): Promise<void> {
  const store = getStore(actor)
  const rec = need(store, id)
  if (rec.unread === 0) return
  rec.unread = 0
  touched(store, rec)
}

// --- adjuntos --------------------------------------------------------------------------------

export async function mockCreateAttachment(
  body: SupportAttachmentCreateBody,
  actor: MockActor
): Promise<SupportAttachmentCreateResult> {
  await sleep(base() * 0.2)
  const store = getStore(actor)
  const rec = need(store, body.conversationId)
  guardWrite(store, rec)
  if (
    !(SUPPORT_ATTACHMENT_TYPES as readonly string[]).includes(body.contentType)
  )
    throw invalidAttachment("Solo se admiten imágenes JPG, PNG o WebP.")
  if (
    !Number.isInteger(body.sizeBytes) ||
    body.sizeBytes <= 0 ||
    body.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES
  )
    throw invalidAttachment("La imagen supera los 5 MB.")
  const attachmentId = randomUUID()
  store.uploads.set(attachmentId, {
    id: attachmentId,
    conversationId: body.conversationId,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
    bytes: null,
    used: false,
  })
  return {
    attachmentId,
    uploadUrl: `/api/support/mock-upload/${attachmentId}`,
    expiresAt: iso(Date.now() + 10 * 60_000),
  }
}

/** Lo que haría S3 al recibir el PUT del `uploadUrl` presignado. */
export function mockStoreUpload(
  id: string,
  contentType: string,
  bytes: Buffer
): boolean {
  const up = globals.__movoSupportMock?.uploads.get(id)
  if (!up || up.bytes || up.contentType !== contentType) return false
  up.bytes = bytes
  return true
}

export function mockReadUpload(
  id: string
): { contentType: string; bytes: Buffer } | null {
  const up = globals.__movoSupportMock?.uploads.get(id)
  return up?.bytes ? { contentType: up.contentType, bytes: up.bytes } : null
}

// --- tiempo real ------------------------------------------------------------------------------

export async function mockRealtimeTicket(
  actor: MockActor
): Promise<SupportRealtimeTicket> {
  getStore(actor)
  if (shouldFail("ws"))
    throw new ApiError(503, "SUPPORT_SERVICE_UNAVAILABLE", "Sin WebSocket.")
  return {
    ticket: randomUUID(),
    // El cliente reconoce `mock://` y simula el WS leyendo `/api/support/events`.
    url: "mock://support",
    expiresAt: iso(Date.now() + 30_000),
  }
}

export async function mockEvents(
  since: string | undefined,
  actor: MockActor
): Promise<SupportEventsPage> {
  const store = getStore(actor)
  const cursor = String(store.seq)
  if (!since) return { events: [], cursor, reset: false }
  const from = Number(since)
  const oldest = store.events[0]
    ? Number(store.events[0].cursor)
    : store.seq + 1
  if (!Number.isFinite(from) || from < oldest - 1)
    return { events: [], cursor, reset: from < store.seq }
  return {
    events: store.events.filter((e) => Number(e.cursor) > from),
    cursor,
    reset: false,
  }
}
