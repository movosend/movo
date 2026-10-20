import type {
  SupportConversation,
  SupportConversationRow,
  SupportUserContext,
} from "@movo/shared/src/types/admin-support"

/** Filas y contexto de ejemplo para los tests de componentes de la bandeja. */
export const row = (over: Partial<SupportConversationRow> = {}): SupportConversationRow => ({
  id: "a1111111-1111-4111-8111-111111111111",
  code: "SOP-1042",
  user: { id: "u1111111-1111-4111-8111-111111111111", fullName: "Carolina Sánchez", role: "receiver" },
  topic: "shipment",
  priority: "urgent",
  status: "open",
  assignee: { id: "me", fullName: "Tomás Ferreyra" },
  unread: 2,
  lastMessage: {
    from: "user",
    authorId: null,
    authorName: "Carolina Sánchez",
    body: "¿Cuánto tarda en resolverse esto?",
    hasAttachments: false,
    createdAt: "2026-10-20T15:00:00.000Z",
  },
  waitMinutes: 23,
  shipment: { id: "s1", code: "MOVO-48176" },
  tags: ["Disputa"],
  lastActivityAt: "2026-10-20T15:00:00.000Z",
  ...over,
})

export const conversation = (over: Partial<SupportConversation> = {}): SupportConversation => ({
  ...row(),
  createdAt: "2026-10-20T14:00:00.000Z",
  resolvedAt: null,
  ...over,
})

export const userContext = (over: Partial<SupportUserContext> = {}): SupportUserContext => ({
  profile: {
    id: "u1",
    fullName: "Carolina Sánchez",
    roles: ["receiver"],
    memberSince: "2025-03-10T12:00:00.000Z",
    email: "caro.sanchez@gmail.com",
    phone: "+54 351 612 4410",
    ratingAverage: 4.9,
    ratingCount: 12,
    shipmentCount: 12,
    tripCount: 0,
  },
  badges: ["identity", "kyc_approved"],
  recentShipments: [
    { id: "s1", code: "MOVO-48176", status: "disputed", statusLabel: "En disputa", tone: "danger", route: "Güemes → Cofico", createdAt: "2026-10-18T12:00:00.000Z" },
  ],
  otherConversations: [
    { conversationId: "c9", code: "SOP-0900", topic: "payments", status: "resolved", createdAt: "2026-08-22T12:00:00.000Z" },
  ],
  ...over,
})
