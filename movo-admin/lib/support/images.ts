import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_TYPES,
  type SupportAttachmentType,
} from "@movo/shared/src/types/admin-support"

/** Lado máximo al que se achica una imagen antes de subirla (MOVO-321: el cliente redimensiona). */
export const MAX_IMAGE_SIDE = 1600

export const isAllowedImageType = (type: string): type is SupportAttachmentType =>
  (SUPPORT_ATTACHMENT_TYPES as readonly string[]).includes(type)

/** `null` si el archivo se puede adjuntar; si no, el motivo para mostrarle al agente. */
export function attachmentProblem(file: File): string | null {
  if (!isAllowedImageType(file.type))
    return `“${file.name || "El archivo"}” no es una imagen JPG, PNG o WebP.`
  return null
}

/** Texto cuando, ya redimensionada, la imagen sigue siendo demasiado pesada. */
export const TOO_BIG = `La imagen supera los ${SUPPORT_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`

/**
 * Achica la imagen a `MAX_IMAGE_SIDE` (conservando el tipo) para subir menos bytes. Si el
 * navegador no puede decodificarla o ya es chica, devuelve el archivo original.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined")
    return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= SUPPORT_ATTACHMENT_MAX_BYTES) {
      bitmap.close()
      return file
    }
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type, 0.85)
    )
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
