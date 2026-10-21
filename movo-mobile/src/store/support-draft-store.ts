import type { SupportTopic } from "@movo/shared/dist/types/admin-support";
import { create } from "zustand";

export interface SupportDraftAttachment {
  attachmentId: string;
  localUri: string;
}

/**
 * MOVO-324: la consulta que se está por crear. "Enviar consulta" pasa directo a la conversación con la burbuja en
 * "Enviando…" (todavía no existe `conversationId`); la pantalla `support/pending` hace el `POST` con este borrador,
 * y si falla ofrece reintentar con el MISMO `clientMessageId` (el backend no duplica). Vive en memoria, no se persiste.
 */
export interface SupportDraft {
  topic: SupportTopic;
  body: string;
  clientMessageId: string;
  shipment: { id: string; code: string } | null;
  attachments: SupportDraftAttachment[];
  createdAt: string;
}

interface SupportDraftState {
  draft: SupportDraft | null;
  setDraft: (draft: SupportDraft) => void;
  clearDraft: () => void;
}

export const useSupportDraftStore = create<SupportDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}));
