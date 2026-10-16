import { ApiError } from "@movo/shared/dist/errors/api-error";
import type {
  CarrierRequirement,
  CarrierRequirementsErrorDetails,
} from "@movo/shared/dist/types/carrier-eligibility";
import type { MpConnectStatusResponse } from "@movo/shared/dist/types/mp-connect";
import { KycStatus } from "@movo/shared/dist/types/user";

/** Orden fijo de la checklist (el del prototipo): primero la licencia, después Mercado Pago. */
export const CARRIER_REQUIREMENT_ORDER: readonly CarrierRequirement[] = ["license", "mp_account"];

/**
 * Qué bloquea la entrada al tab Transportar (MOVO-167 / MOVO-117): `"identity"` o la
 * lista de `CarrierRequirement` que faltan (checklist). `null` = puede pasar.
 */
export type TransportGate = "identity" | CarrierRequirement[];

/**
 * Qué requisito bloquea la entrada al tab Transportar según el perfil propio y el estado
 * de Mercado Pago, en orden de prioridad: la identidad va primero y sin ella no se muestra
 * la checklist (nunca dos CTAs a la vez, AC3 de MOVO-167); con la identidad aprobada se
 * devuelve todo lo que falta (licencia y/o MP) para pintar la checklist completa.
 *
 * Es solo UX: la validación autoritativa es del backend (ADR-036). `unlinked` e `invalid`
 * cuentan como MP faltante (mismo criterio que el hold: una cuenta inválida no cobra).
 * Un dato todavía no disponible (`null`) no bloquea por sí solo — el que llama decide
 * qué mostrar mientras carga o si la consulta falló.
 *
 * El 403 `CARRIER_NOT_VERIFIED` de `GET /shipments/available` (el perfil cacheado puede
 * estar viejo, el backend no) lo suma la pantalla encima de este resultado.
 */
export function resolveTransportGate(input: {
  kycStatus: KycStatus | null;
  licenseKycStatus: KycStatus | null;
  mpStatus?: MpConnectStatusResponse["status"] | null;
}): TransportGate | null {
  if (input.kycStatus !== null && input.kycStatus !== KycStatus.APPROVED) return "identity";
  const missing: CarrierRequirement[] = [];
  if (input.licenseKycStatus !== null && input.licenseKycStatus !== KycStatus.APPROVED) {
    missing.push("license");
  }
  if (input.mpStatus != null && input.mpStatus !== "linked") missing.push("mp_account");
  return missing.length > 0 ? missing : null;
}

/**
 * Requisitos faltantes que informa un 403 del backend (MOVO-116), o `null` si el error es
 * otra cosa. Se decide por `code`, no por status HTTP: `CARRIER_MP_ACCOUNT_NOT_LINKED`
 * llega como 403 desde `svc-shipments` y sigue siendo 409 en los holds de `svc-payments`
 * (por eso solo se llama desde pantallas de acciones del transportista).
 * El `code` es solo el primer requisito que falta; la lista completa viene en
 * `details.missingRequirements`. Un 502 `*_SERVICE_UNAVAILABLE` no es un requisito.
 *
 * MOVO-278 (ADR-045): `CARRIER_DISPUTE_OPEN` (requisito `no_open_dispute`) tampoco abre la
 * checklist: no es un paso que el transportista pueda completar, se levanta cuando se
 * resuelve la disputa. Devuelve `null` y el caller muestra el mensaje de error.
 *
 * MOVO-313 (ADR-044): `USER_DEBT_OVERDUE` (requisito `no_overdue_debt`) tampoco: se resuelve
 * con un pago, no con un paso de la checklist. Mismo criterio: `null` y el mensaje de error.
 * Y si llega como parte de `details.missingRequirements` de otro código (licencia/MP), el
 * filtro por `CARRIER_REQUIREMENT_ORDER` lo descarta: la checklist solo dibuja los dos pasos.
 */
export function carrierRequirementsFromError(error: unknown): CarrierRequirement[] | null {
  if (!(error instanceof ApiError)) return null;
  const firstMissing: CarrierRequirement | null =
    error.code === "CARRIER_LICENSE_NOT_APPROVED"
      ? "license"
      : error.code === "CARRIER_MP_ACCOUNT_NOT_LINKED"
        ? "mp_account"
        : null;
  if (firstMissing === null) return null;
  const reported = (error.details as Partial<CarrierRequirementsErrorDetails> | undefined)
    ?.missingRequirements;
  const valid = Array.isArray(reported)
    ? CARRIER_REQUIREMENT_ORDER.filter((requirement) => reported.includes(requirement))
    : [];
  return valid.length > 0 ? valid : [firstMissing];
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

/** Fila de la checklist (MOVO-117): estado, pill, explicación y CTA de un requisito. */
export interface RequirementRowCopy {
  title: string;
  /** `done` = "Listo" (sin CTA); `review` = en revisión (CTA "Ver estado"); `pending` = "Pendiente". */
  state: "done" | "review" | "pending";
  pillLabel: string;
  body: string;
  /** Solo si el requisito no está cumplido. */
  ctaLabel: string | null;
}

const LICENSE_ROW_TITLE = "Licencia de conducir verificada";
const MP_ROW_TITLE = "Cuenta de Mercado Pago vinculada";
const LICENSE_ROW_CTA = "Verificar mi licencia";
const MP_ROW_CTA = "Vincular Mercado Pago";

/**
 * Fila de licencia de la checklist. Textos del prototipo de MOVO-117; los estados que el
 * prototipo no dibuja (en revisión, sin terminar, rechazada, vencida) reusan el copy por
 * estado de `licenseGateCopy` (MOVO-167) y solo cambian el CTA donde corresponde.
 */
export function licenseRowCopy(status: KycStatus | null): RequirementRowCopy {
  if (status === KycStatus.APPROVED) {
    return {
      title: LICENSE_ROW_TITLE,
      state: "done",
      pillLabel: "Listo",
      body: "Verificada. Ya tenés la insignia de licencia.",
      ctaLabel: null,
    };
  }
  if (status === KycStatus.MANUAL_REVIEW) {
    return {
      title: LICENSE_ROW_TITLE,
      state: "review",
      pillLabel: "En revisión",
      body: licenseGateCopy(status).body,
      ctaLabel: "Ver estado",
    };
  }
  const base = {
    title: LICENSE_ROW_TITLE,
    state: "pending" as const,
    pillLabel: "Pendiente",
  };
  if (status === KycStatus.PENDING || status === KycStatus.REJECTED || status === KycStatus.EXPIRED) {
    return {
      ...base,
      body: licenseGateCopy(status).body,
      ctaLabel: status === KycStatus.PENDING ? "Continuar verificación" : LICENSE_ROW_CTA,
    };
  }
  return {
    ...base,
    body: "Verificamos que puedas manejar el vehículo con el que viajás.",
    ctaLabel: LICENSE_ROW_CTA,
  };
}

/** Fila de Mercado Pago de la checklist. `invalid` (token vencido/revocado) cuenta como faltante. */
export function mpRowCopy(status: MpConnectStatusResponse["status"] | null): RequirementRowCopy {
  if (status === "linked") {
    return {
      title: MP_ROW_TITLE,
      state: "done",
      pillLabel: "Listo",
      body: "Vinculada. Tus cobros van a esa cuenta.",
      ctaLabel: null,
    };
  }
  return {
    title: MP_ROW_TITLE,
    state: "pending",
    pillLabel: "Pendiente",
    body:
      status === "invalid"
        ? "Tu cuenta dejó de estar vigente. Volvé a vincularla para que te acreditemos lo que cobrás."
        : "Ahí te acreditamos lo que cobrás por cada envío.",
    ctaLabel: MP_ROW_CTA,
  };
}
