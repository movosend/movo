import { ApiError } from "@movo/shared/dist/errors/api-error";
import { CameraView, useCameraPermissions } from "expo-camera";
import { AlertTriangle, Camera as CameraIcon } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import type { ConfirmHandshakeResult } from "../../src/api/shipments-client";
import { shipmentsClient } from "../../src/api/shipments-client";
import { getCurrentLocation } from "../../src/lib/location";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { PrimaryButton } from "../auth/primary-button";

interface HandshakeScanStepProps {
  shipmentId: string;
  onConfirmed: (result: ConfirmHandshakeResult) => void;
  /** MOVO-198 AC9: si el backend igual rechaza por falta de evidencia (caso
   * defensivo -- no debería pasar si el wizard gatea bien la navegación al paso de
   * escaneo), el wizard contenedor vuelve al paso de evidencia en vez de dejar que
   * el usuario reintente escanear en un loop sin salida. Sin esta prop (la ruta
   * standalone de MOVO-160, `DevHandshakeScreen`) el código sigue cayendo al banner
   * genérico de siempre, comportamiento sin cambios. */
  onEvidenceMissing?: () => void;
  testID?: string;
}

interface ScannedQrPayload {
  shipmentId: string;
  nonce: string;
  signature: string;
}

/** Formato acordado con el lado que genera el QR (MOVO-159, comentario dejado en
 * Linear) — JSON con exactamente estos 3 campos. Devuelve `null` sin lanzar ante
 * cualquier string que no matchee, para que el caller lo trate como "código
 * inválido" y no como una excepción a propagar. */
function parseScannedPayload(raw: string): ScannedQrPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.shipmentId === "string" &&
      typeof parsed.nonce === "string" &&
      typeof parsed.signature === "string"
    ) {
      return { shipmentId: parsed.shipmentId, nonce: parsed.nonce, signature: parsed.signature };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Paso reusable de escaneo de QR + captura de GPS + confirmación del handshake
 * (MOVO-160). Sin conocer wizard/orquestación — MOVO-198/MOVO-199 lo montan como un
 * paso más de sus propios flujos de retiro/entrega.
 *
 * El scanner nunca firma nada: la firma que viaja en el QR es la que ya generó el
 * cedente (MOVO-159 + `signHandshakeNonce()` de MOVO-195) — acá solo se relee lo
 * escaneado y se agrega la posición GPS propia.
 */
export function HandshakeScanStep({ shipmentId, onConfirmed, onEvidenceMissing, testID }: HandshakeScanStepProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isConfirming, setIsConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Distinto del resto de los errores (AC5): `HANDSHAKE_DISTANCE_EXCEEDED` permite
   * reintentar la MISMA confirmación (re-leer el GPS y reenviar el mismo
   * nonce/signature) sin tener que volver a escanear — el QR sigue vigente dentro
   * de su TTL de 15s, solo hace falta acercarse. */
  const retryablePayloadRef = useRef<ScannedQrPayload | null>(null);
  const [canRetrySameScan, setCanRetrySameScan] = useState(false);
  const isProcessingRef = useRef(false);

  async function confirmWithPayload(payload: ScannedQrPayload) {
    setIsConfirming(true);
    setErrorMessage(null);
    try {
      const location = await getCurrentLocation();
      if (!location.granted) {
        setErrorMessage(
          "Necesitamos tu ubicación para confirmar esto — sin GPS no podemos verificar la distancia.",
        );
        retryablePayloadRef.current = payload;
        setCanRetrySameScan(true);
        return;
      }

      const result = await shipmentsClient.confirmHandshake(payload.shipmentId, {
        nonce: payload.nonce,
        signature: payload.signature,
        lat: location.lat,
        lng: location.lng,
      });
      retryablePayloadRef.current = null;
      setCanRetrySameScan(false);
      onConfirmed(result);
    } catch (err) {
      const isEvidenceMissing =
        err instanceof ApiError && (err.code === "PICKUP_EVIDENCE_MISSING" || err.code === "DELIVERY_EVIDENCE_MISSING");
      if (isEvidenceMissing && onEvidenceMissing) {
        onEvidenceMissing();
        return;
      }
      const isDistanceExceeded = err instanceof ApiError && err.code === "HANDSHAKE_DISTANCE_EXCEEDED";
      retryablePayloadRef.current = isDistanceExceeded ? payload : null;
      setCanRetrySameScan(isDistanceExceeded);
      setErrorMessage(friendlyErrorMessage(err, "No pudimos confirmar esto. Intentá de nuevo."));
    } finally {
      setIsConfirming(false);
      isProcessingRef.current = false;
    }
  }

  function handleBarcodeScanned(result: { data: string }) {
    if (isProcessingRef.current || isConfirming) return;
    isProcessingRef.current = true;

    const payload = parseScannedPayload(result.data);
    if (!payload) {
      isProcessingRef.current = false;
      setErrorMessage("Este código no es válido. Pedile a la otra persona que genere uno nuevo.");
      setCanRetrySameScan(false);
      retryablePayloadRef.current = null;
      return;
    }

    void confirmWithPayload(payload);
  }

  function handleDismissError() {
    setErrorMessage(null);
    setCanRetrySameScan(false);
    retryablePayloadRef.current = null;
    isProcessingRef.current = false;
  }

  function handleRetrySameScan() {
    const payload = retryablePayloadRef.current;
    if (!payload) return;
    setErrorMessage(null);
    isProcessingRef.current = true;
    void confirmWithPayload(payload);
  }

  if (!permission) {
    return <View testID={testID} className="flex-1 bg-ink-950" />;
  }

  if (!permission.granted) {
    return (
      <View testID={testID} className="flex-1 items-center justify-center gap-5 bg-bg px-8">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-bg-mute">
          <CameraIcon size={26} color="#5A5A62" strokeWidth={1.8} />
        </View>
        <Text className="text-center font-sans-semibold text-h3 text-fg">
          Necesitamos acceso a tu cámara
        </Text>
        <Text className="text-center font-sans text-body text-fg-2">
          Para escanear el código y confirmar la transferencia del paquete.
        </Text>
        <PrimaryButton
          testID="handshake-scan-request-permission"
          label={permission.canAskAgain ? "Dar acceso a la cámara" : "Abrir ajustes"}
          onPress={() => {
            if (permission.canAskAgain) {
              void requestPermission();
            } else {
              Alert.alert(
                "Permiso necesario",
                "Habilitá el acceso a la cámara desde los ajustes de tu dispositivo para poder escanear el código.",
                [
                  { text: "Cancelar", style: "cancel" },
                  { text: "Abrir Ajustes", onPress: () => void Linking.openSettings() },
                ],
              );
            }
          }}
        />
      </View>
    );
  }

  return (
    <View testID={testID} className="flex-1 bg-ink-950">
      <CameraView
        testID="handshake-camera-view"
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={isConfirming ? undefined : handleBarcodeScanned}
      />

      {/* Overlay como hermano absoluto de la cámara: `CameraView` no soporta children
          (la vista nativa no los dibuja encima del preview). */}
      <View pointerEvents="box-none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
        <View pointerEvents="none" className="flex-1 items-center justify-center">
          <View className="h-44 w-44 rounded-2xl border-2 border-lime-500/70" />
          {/* Absoluto bajo el recuadro: el texto no desplaza el centro del recuadro. */}
          <Text
            className="absolute inset-x-8 text-center font-sans text-[13px] text-white/70"
            style={{ top: "50%", marginTop: 88 + 20 }}
          >
            {isConfirming ? "Confirmando…" : "Apuntá al código de la otra persona"}
          </Text>
        </View>

        {errorMessage ? (
          <View
            testID="handshake-scan-error"
            className="absolute inset-x-0 bottom-0 gap-4 rounded-t-3xl bg-white px-5 pb-10 pt-5"
          >
            <View className="flex-row items-start gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-danger-500/10">
                <AlertTriangle size={18} color="#E5484D" strokeWidth={2.4} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-sans-semibold text-body text-ink-950">
                  {canRetrySameScan ? "Estás muy lejos" : "No pudimos confirmar"}
                </Text>
                <Text className="font-sans text-[13px] leading-[18px] text-ink-950/70">{errorMessage}</Text>
              </View>
            </View>
            <Pressable
              testID={canRetrySameScan ? "handshake-scan-retry" : "handshake-scan-dismiss"}
              onPress={canRetrySameScan ? handleRetrySameScan : handleDismissError}
              disabled={isConfirming}
              className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-3.5 active:opacity-80"
            >
              {isConfirming ? <ActivityIndicator color="#0A0A0B" /> : null}
              <Text className="font-sans-semibold text-body text-ink-950">
                {canRetrySameScan ? "Reintentar" : "Volver a escanear"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
