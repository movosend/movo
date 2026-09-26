import { ApiError } from "@movo/shared";
import { UsersClient } from "../adapters/users-client";

type WarnLogger = { warn: (obj: unknown, msg?: string) => void };

/**
 * MOVO-175 (fix de review, PR #193): `safeBlockRelatedUserIds` degrada a "sin
 * filtrar" ante cualquier falla, sin costo -- no vale la pena esperar el timeout
 * largo del cliente (5000ms, pensado para una escritura que sí debe fallar cerrado)
 * si `svc-users` está colgado y no caído. Mismo criterio que
 * `pricing-client.ts` (3000ms, mismo motivo).
 */
const SAFE_BLOCK_RELATIONS_TIMEOUT_MS = 1500;

/**
 * MOVO-175 (ADR-026): falla CERRADO -- para escrituras (crear oferta, aceptar oferta,
 * crear envío). Si alguno de `otherUserIds` tiene un bloqueo con `userId` en
 * cualquier dirección, 403 `USER_BLOCKED` explícito (decisión de producto: se revela
 * el bloqueo en vez de un error genérico). Un svc-users caído propaga su 502, mismo
 * criterio que el gate de KYC.
 */
export async function assertNotBlocked(
  usersClient: UsersClient,
  userId: string,
  otherUserIds: Array<string | null | undefined>,
): Promise<void> {
  const others = otherUserIds.filter((id): id is string => Boolean(id) && id !== userId);
  if (others.length === 0) return;
  const related = new Set(await usersClient.listBlockRelatedUserIds(userId));
  if (others.some((id) => related.has(id))) {
    throw new ApiError(403, "USER_BLOCKED", "No podés interactuar con este usuario porque hay un bloqueo entre ustedes.");
  }
}

/**
 * MOVO-175 (ADR-026): falla ABIERTO -- para listados y push. Si svc-users no
 * responde se muestra/notifica sin filtrar (y se loguea): un feed caído por un
 * servicio lateral es peor que mostrar de más, y cualquier interacción posterior
 * igual pasa por `assertNotBlocked`.
 */
export async function safeBlockRelatedUserIds(
  usersClient: UsersClient,
  userId: string,
  logger?: WarnLogger,
): Promise<string[]> {
  try {
    return await usersClient.listBlockRelatedUserIds(userId, SAFE_BLOCK_RELATIONS_TIMEOUT_MS);
  } catch (error) {
    logger?.warn(
      { userId, event: "block_relations_fetch_failed", error: (error as Error).message },
      "No se pudieron resolver los bloqueos del usuario; se sigue sin filtrar",
    );
    return [];
  }
}
