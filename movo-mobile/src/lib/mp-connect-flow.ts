import type {
  MpConnectReturnErrorCode,
  MpConnectStatus,
} from "@movo/shared/dist/types/mp-connect";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";

const RETURN_ERROR_CODES: readonly MpConnectReturnErrorCode[] = [
  "MP_CONNECT_STATE_INVALID",
  "MP_CONNECT_ACCESS_DENIED",
  "MP_CONNECT_EXCHANGE_FAILED",
  "MP_ACCOUNT_ALREADY_LINKED",
];

/**
 * Qué devolvió el navegador embebido, ya leído. `returned` = volvió por el deep link de
 * `MP_CONNECT_RETURN_URL`; `closed` = el usuario lo cerró (cancel/dismiss) o no volvió
 * por el deep link.
 */
export type AuthSessionReturn =
  | { kind: "returned"; result: "success" }
  | { kind: "returned"; result: "error"; code: MpConnectReturnErrorCode | null }
  | { kind: "closed" };

/** Parseo a mano: el `URLSearchParams` de React Native no siempre implementa `get`. */
function readQueryParams(url: string): Record<string, string> {
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  const params: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const [rawKey, rawValue = ""] = pair.split("=");
    params[safeDecode(rawKey)] = safeDecode(rawValue.replace(/\+/g, " "));
  }
  return params;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseAuthSessionResult(result: WebBrowserAuthSessionResult): AuthSessionReturn {
  if (result.type !== "success" || !("url" in result) || !result.url) return { kind: "closed" };

  const params = readQueryParams(result.url);
  if (params.result === "success") return { kind: "returned", result: "success" };

  const known = RETURN_ERROR_CODES.find((c) => c === params.code) ?? null;
  return { kind: "returned", result: "error", code: known };
}

export const LINK_CANCELLED_MESSAGE =
  "No pudimos vincular tu cuenta. Cancelaste el inicio de sesión o Mercado Pago no respondió. Probá de nuevo.";
export const LINK_UNCONFIRMED_MESSAGE = "No pudimos confirmar la vinculación. Probá de nuevo.";

/**
 * Resultado final del intento de vincular, cruzando lo que devolvió el navegador con el
 * status que se volvió a consultar. El deep link nunca decide solo que quedó vinculada
 * (cualquiera puede abrir `movo://mp-connect?result=success`): manda el status.
 *
 * - Status `linked`: listo, sin importar cómo volvió el navegador. Cubre el `dismiss`
 *   que a veces devuelve Android aunque la vinculación haya salido bien.
 * - Si no, un mensaje de error que se muestra encima del estado real.
 */
export type LinkOutcome =
  | { kind: "linked" }
  | { kind: "error"; code: MpConnectReturnErrorCode | null; fallbackMessage: string };

export interface MpConnectLinkDeps {
  getAuthorizationUrl: () => Promise<string>;
  openAuthSession: (authorizationUrl: string) => Promise<WebBrowserAuthSessionResult>;
  /** Se llama recién cuando el navegador se cerró: ahí empieza "Terminando la vinculación…". */
  onBrowserClosed?: () => void;
  refetchStatus: () => Promise<MpConnectStatus>;
}

/**
 * El flujo completo de vincular, sin React (así se testea sin montar `useMutation`, que
 * cuelga Jest en este setup, ver MOVO-136). Si falla pedir la URL, tira: no se abrió
 * nada y el caller muestra el error de la API. Después de abrir el navegador, el status
 * se vuelve a consultar siempre, salga como salga.
 */
export async function runMpConnectLink(deps: MpConnectLinkDeps): Promise<LinkOutcome> {
  const authorizationUrl = await deps.getAuthorizationUrl();
  const result = await deps.openAuthSession(authorizationUrl);
  deps.onBrowserClosed?.();
  const refreshed = await deps.refetchStatus();
  return resolveLinkOutcome(parseAuthSessionResult(result), refreshed);
}

export function resolveLinkOutcome(
  returned: AuthSessionReturn,
  refreshedStatus: MpConnectStatus,
): LinkOutcome {
  if (refreshedStatus === "linked") return { kind: "linked" };
  if (returned.kind === "closed") {
    return { kind: "error", code: null, fallbackMessage: LINK_CANCELLED_MESSAGE };
  }
  if (returned.result === "success") {
    return { kind: "error", code: null, fallbackMessage: LINK_UNCONFIRMED_MESSAGE };
  }
  return { kind: "error", code: returned.code, fallbackMessage: LINK_CANCELLED_MESSAGE };
}
