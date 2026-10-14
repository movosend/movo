import { KycStatus } from "@movo/shared/dist/types/user";

export type TransportGate = "identity" | "license";

/**
 * Qué requisito bloquea la entrada al tab Transportar según el perfil propio (MOVO-167),
 * en orden de prioridad: la identidad va primero y recién con la identidad aprobada se
 * pide la licencia (AC3 del ticket) — nunca dos CTAs a la vez.
 *
 * El 403 `CARRIER_NOT_VERIFIED` de `GET /shipments/available` (el perfil cacheado puede
 * estar viejo, el backend no) lo suma la pantalla encima de este resultado.
 * Sin perfil todavía (`null`) no se bloquea por licencia — el que llama decide qué
 * mostrar mientras carga.
 */
export function resolveTransportGate(input: {
  kycStatus: KycStatus | null;
  licenseKycStatus: KycStatus | null;
}): TransportGate | null {
  if (input.kycStatus !== null && input.kycStatus !== KycStatus.APPROVED) return "identity";
  if (input.licenseKycStatus !== null && input.licenseKycStatus !== KycStatus.APPROVED) return "license";
  return null;
}

export interface RequirementCopy {
  title: string;
  body: string;
  ctaLabel: string;
}

export const IDENTITY_GATE_COPY: RequirementCopy = {
  title: "Verificá tu identidad para transportar",
  body: "Necesitás tu identidad verificada para ver y aceptar envíos disponibles.",
  ctaLabel: "Verificar identidad",
};

const LICENSE_TITLE = "¡Verificá tu licencia para transportar paquetes!";
const LICENSE_CTA = "Verificar licencia";

/**
 * Copy del bloqueo por licencia según en qué quedó la verificación. Solo cambia la
 * explicación (y el CTA en revisión, donde no hay nada que "verificar" de nuevo): el
 * título del ticket se mantiene salvo en `manual_review`, donde pedirle que verifique
 * algo que ya mandó se lee como un error.
 */
export function licenseGateCopy(status: KycStatus): RequirementCopy {
  switch (status) {
    case KycStatus.MANUAL_REVIEW:
      return {
        title: "Estamos revisando tu licencia",
        body: "Apenas la aprobemos vas a poder ver y ofertar envíos. Te avisamos cuando esté lista.",
        ctaLabel: "Ver estado",
      };
    case KycStatus.PENDING:
      return {
        title: LICENSE_TITLE,
        body: "Tu verificación de licencia quedó sin terminar. Retomala para empezar a transportar.",
        ctaLabel: "Continuar verificación",
      };
    case KycStatus.REJECTED:
      return {
        title: LICENSE_TITLE,
        body: "No pudimos verificar tu licencia. Revisá los datos e intentá de nuevo para transportar.",
        ctaLabel: LICENSE_CTA,
      };
    case KycStatus.EXPIRED:
      return {
        title: LICENSE_TITLE,
        body: "Tu verificación de licencia venció. Iniciá una nueva para seguir transportando.",
        ctaLabel: LICENSE_CTA,
      };
    default:
      return {
        title: LICENSE_TITLE,
        body: "Para llevar envíos necesitás tu licencia de conducir verificada. Es un trámite corto desde la app.",
        ctaLabel: LICENSE_CTA,
      };
  }
}
