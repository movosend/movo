import { AdminBlock, ApiError } from "@movo/shared";

/**
 * Un bloque que vive en otro servicio: si ese servicio no responde, el bloque viene en `null` con su causa y el
 * resto de la respuesta se devuelve igual (MOVO-325 AC9; también la home de MOVO-342).
 */
export async function block<T>(load: () => Promise<T>): Promise<AdminBlock<T>> {
  try {
    return { data: await load(), error: null };
  } catch (error) {
    if (error instanceof ApiError) return { data: null, error: { code: error.code, message: error.message } };
    return { data: null, error: { code: "BLOCK_UNAVAILABLE", message: "No se pudo obtener este bloque." } };
  }
}
