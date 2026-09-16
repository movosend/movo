/**
 * MOVO-196: mínimo/máximo de fotos CONFIRMADAS de las etapas `pickup`/`delivery` --
 * evidencia exigida antes de poder confirmar el handshake de retiro/entrega
 * (MOVO-158). Constantes nombradas (AC7: "no hardcodeada en el flujo"), mismo
 * criterio que `MIN_CREATION_PHOTOS_TO_PUBLISH` (`shipment-state-machine.ts`,
 * MOVO-81) para la etapa `creation` -- ese mínimo es una regla de negocio distinta
 * (gatea `-> published`, no el handshake), por eso vive en un módulo propio en vez
 * de sumarse ahí.
 */
export const MIN_EVIDENCE_PHOTOS_PER_STAGE = 1;

/** AC8: superar este tope al confirmar una foto de `pickup`/`delivery` responde 422. */
export const MAX_EVIDENCE_PHOTOS_PER_STAGE = 5;
