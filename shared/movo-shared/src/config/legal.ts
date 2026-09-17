/**
 * Versión vigente de cada documento legal (MOVO-228) — fuente única de verdad
 * compartida entre `movo-svc-users` (valida contra qué versión se aceptó al
 * registrarse, la persiste) y `movo-mobile` (la manda al registrarse, y la
 * usa para saber si el usuario aceptó la versión más reciente al mostrar la
 * "firma electrónica" en Perfil → Legal).
 *
 * El valor es la fecha de "Última actualización" del propio documento
 * (`docs/legal/politica-privacidad.md`/`terminos-y-condiciones.md`). Este
 * archivo, y `movo-mobile/src/content/legal/*.ts` (la copia empaquetada del
 * contenido), se generan a partir del `.md` con `npm run sync:legal`
 * (`scripts/sync-legal-docs.ts`) — no editar a mano. El flujo real: bumpear
 * "Última actualización" en el `.md`, correr `npm run sync:legal`, commitear
 * los 3 archivos juntos. Sin ese bump, una app vieja que manda la versión
 * anterior seguiría pasando la validación del backend con contenido que ya
 * cambió.
 */
export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-09-14",
  privacy: "2026-09-14",
} as const;

export type LegalDocumentKind = keyof typeof LEGAL_DOCUMENT_VERSIONS;
