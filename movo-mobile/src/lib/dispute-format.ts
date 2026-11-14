import { DisputeReason, type DisputePartyRole, type DisputeSummary } from "@movo/shared/dist/types/dispute";

/** Por qué se abrió, como cláusula ("el paquete llegó dañado"). `other` no tiene cláusula: se dice "por otro motivo". */
const REASON_CLAUSE: Record<DisputeReason, string | null> = {
  [DisputeReason.DAMAGED]: "el paquete llegó dañado",
  [DisputeReason.NOT_DELIVERED]: "el paquete no llegó a destino",
  [DisputeReason.WRONG_DELIVERY]: "se entregó en otro lugar o a otra persona",
  [DisputeReason.OTHER]: null,
  [DisputeReason.TRANSIT_ANOMALY]: "el envío quedó en camino más tiempo del esperado",
  [DisputeReason.PICKUP_NO_SHOW]: "el retiro no se concretó en el horario acordado",
};

const PARTY_LABEL: Record<DisputePartyRole, string> = {
  sender: "el emisor",
  receiver: "el receptor",
  carrier: "el transportista",
};

/** Motivo corto, para una fila ("Llegó dañado"). */
const REASON_SHORT: Record<DisputeReason, string> = {
  [DisputeReason.DAMAGED]: "Llegó dañado",
  [DisputeReason.NOT_DELIVERED]: "No llegó a destino",
  [DisputeReason.WRONG_DELIVERY]: "Entrega equivocada",
  [DisputeReason.OTHER]: "Otro motivo",
  [DisputeReason.TRANSIT_ANOMALY]: "Demora en el camino",
  [DisputeReason.PICKUP_NO_SHOW]: "Retiro no concretado",
};

export function disputeReasonShortLabel(reason: DisputeReason): string {
  return REASON_SHORT[reason] ?? "Otro motivo";
}

/**
 * Quién abrió la disputa y por qué, visto por `viewerRole`: "La abrió el emisor porque el paquete llegó dañado.",
 * "La abriste vos por otro motivo.", "La abrió Movo porque el envío quedó en camino más tiempo del esperado.".
 * Sin la descripción libre de quien la abrió: esa va en el expediente.
 */
export function disputeExplanation(
  dispute: Pick<DisputeSummary, "reason" | "openedByRole">,
  /** `null`: quien mira no es una parte vigente (p. ej. el receptor que pasó la recepción): nunca "La abriste vos". */
  viewerRole: DisputePartyRole | null,
): string {
  const clause = REASON_CLAUSE[dispute.reason] ?? null;
  const why = clause ? `porque ${clause}` : "por otro motivo";
  if (dispute.openedByRole === null) return `La abrió Movo ${why}.`;
  if (viewerRole !== null && dispute.openedByRole === viewerRole) return `La abriste vos ${why}.`;
  return `La abrió ${PARTY_LABEL[dispute.openedByRole]} ${why}.`;
}
