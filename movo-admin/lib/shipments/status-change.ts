import "server-only"
import { cookies } from "next/headers"
import type {
  ChangeShipmentStatusRequest,
  ChangeShipmentStatusResponse,
  ShipmentStatusOptions,
  StepUpChallenge,
  StepUpRequest,
  StepUpToken,
  StepUpVerifyRequest,
} from "@movo/shared/src/types/admin-shipments"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"

/**
 * Cambio de estado de un envío desde el panel (MOVO-333, backend de MOVO-332). Todo va contra `svc-admin` por el
 * gateway: qué transiciones hay, su riesgo y sus efectos salen de `status-options`, no de constantes del panel.
 * Son escrituras: sin reintento automático (una que no respondió pudo haberse aplicado).
 */
const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value
const shipmentPath = (id: string) =>
  `/admin/shipments/${encodeURIComponent(id)}`

/** `GET /admin/shipments/:id/status-options`. */
export async function getStatusOptions(
  id: string
): Promise<ShipmentStatusOptions> {
  return gateway(`${shipmentPath(id)}/status-options`, {
    accessToken: await token(),
  })
}

/** `POST /admin/step-up`: manda el código de 6 dígitos al email del admin, atado a (envío, destino). */
export async function requestStepUp(
  body: StepUpRequest
): Promise<StepUpChallenge> {
  return gateway("/admin/step-up", { body, accessToken: await token() })
}

/** `POST /admin/step-up/verify`: canjea el código por un `stepUpToken` de un solo uso. */
export async function verifyStepUp(
  body: StepUpVerifyRequest
): Promise<StepUpToken> {
  return gateway("/admin/step-up/verify", { body, accessToken: await token() })
}

/** `POST /admin/shipments/:id/status`. */
export async function changeStatus(
  id: string,
  body: ChangeShipmentStatusRequest
): Promise<ChangeShipmentStatusResponse> {
  return gateway(`${shipmentPath(id)}/status`, {
    body,
    accessToken: await token(),
  })
}
