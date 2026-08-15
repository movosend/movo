import { ApiError } from "@movo/shared";
import { PushNotificationProvider } from "./push-notification-provider";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface ExpoPushTicket {
  status: "ok" | "error";
  message?: string;
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
}

/**
 * Implementación real sobre la API pública de Expo Push (ADR-016 candidato) — `fetch`
 * nativo de Node 20, mismo criterio que `google-geocoding-provider.ts` (sin `axios`).
 * No requiere Firebase/APNs propios ni credenciales: Expo intermedia la entrega.
 */
export function createExpoPushProvider(): PushNotificationProvider {
  return {
    async send(input): Promise<void> {
      let response: Response;
      try {
        response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              to: input.expoPushToken,
              title: input.title,
              body: input.body,
              data: input.data,
            },
          ]),
        });
      } catch {
        throw new ApiError(502, "PUSH_PROVIDER_ERROR", "No se pudo conectar con el proveedor de push notifications.");
      }

      if (!response.ok) {
        throw new ApiError(502, "PUSH_PROVIDER_ERROR", "El proveedor de push notifications devolvió un error.");
      }

      let body: ExpoPushResponse;
      try {
        body = (await response.json()) as ExpoPushResponse;
      } catch {
        throw new ApiError(502, "PUSH_PROVIDER_ERROR", "El proveedor de push notifications devolvió una respuesta inválida.");
      }
      const ticket = body.data?.[0];
      // Expo puede responder 200 y aun así reportar el envío puntual como fallido
      // (ticket.status === "error", ej. token con formato válido pero ya no
      // registrado) -- un status HTTP 2xx no es suficiente para saber que llegó.
      if (!ticket || ticket.status === "error") {
        throw new ApiError(
          502,
          "PUSH_PROVIDER_ERROR",
          ticket?.message ?? "El proveedor de push notifications no pudo entregar el mensaje.",
        );
      }
    },
  };
}
