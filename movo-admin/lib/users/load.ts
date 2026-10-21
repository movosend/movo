import "server-only"
import { cache } from "react"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { getUserSection } from "./api"
import type { SectionKey, SectionMap, SectionParams } from "./sections"

export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number }

/**
 * Carga una sección sin lanzar: la ficha muestra el error en el lugar de esa sección y el resto
 * sigue (AC3 de MOVO-293). Un 401/403 se trata como cualquier otra falla acá; la sesión ya la
 * validó la página con `requireAdmin`.
 */
export async function loadSection<K extends SectionKey>(
  id: string,
  key: K,
  params: SectionParams = {}
): Promise<Loaded<SectionMap[K]>> {
  try {
    return { ok: true, data: await getUserSection(id, key, params) }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof ApiError ? error.statusCode : 503,
    }
  }
}

/** `moderation` alimenta Reportes y Bloqueos: se pide una sola vez por render. */
export const loadModeration = cache((id: string) =>
  loadSection(id, "moderation")
)
