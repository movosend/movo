import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { RefreshCw, AlertCircle, QrCode } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useScanBrightness } from "../../src/hooks/use-scan-brightness";
import { MovoIsotype } from "../ui/movo-isotype";

export interface HandshakeQrCardProps {
  qrPayload: string | null;
  isGenerating?: boolean;
  error?: string | null;
  counterpartName?: string;
  stage: "pickup" | "delivery" | null;
  /** Reintento manual, solo se ofrece ante un error: en el camino feliz el QR se
   * renueva solo (`useHandshakeQr`). */
  onRegenerate: () => void;
  testID?: string;
}

const QR_SIZE = 248;
/** Alto que ocupa el aviso "se renueva solo" debajo del QR (padding + una línea). */
const HINT_HEIGHT = 40;
/** Corrimiento extra hacia arriba: el centro geométrico de un área alta se percibe
 * bajo, el ojo espera el foco un poco por encima. */
const OPTICAL_LIFT = 16;

/**
 * QR que el cedente le muestra a la contraparte (emisor en el retiro, transportista
 * en la entrega). Sin countdown: el hook renueva el código antes de que venza, así
 * que lo que está en pantalla siempre sirve. Mientras está montado sube el brillo al
 * máximo para que el escaneo no dependa del brillo que tenga el teléfono.
 *
 * Solo el recuadro del QR lleva sombra -- es lo único que tiene que destacarse; el
 * resto va plano sobre el fondo de la pantalla.
 */
export function HandshakeQrCard({
  qrPayload,
  isGenerating,
  error,
  counterpartName,
  stage,
  onRegenerate,
  testID = "handshake-qr-card",
}: HandshakeQrCardProps) {
  const colors = useThemeColors();
  useScanBrightness();

  const handleRegenerate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRegenerate();
  };

  const stageLabel = stage === "pickup" ? "el retiro" : "la entrega";
  const subtitle = counterpartName
    ? `${counterpartName} tiene que escanear este QR desde su app para confirmar ${stageLabel}.`
    : `La otra persona tiene que escanear este código desde su app para confirmar ${stageLabel}.`;

  const showSpinner = isGenerating && !qrPayload;

  return (
    <View testID={testID} className="w-full flex-1 gap-6">
      {/* Mismo encabezado que el resto de los pasos del wizard (ver EvidenceCaptureStep). */}
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <QrCode size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">
          Mostrale el código
        </Text>
        <Text className="font-sans text-body text-fg-2">{subtitle}</Text>
      </View>

      {/* Se centra el conjunto QR + aviso, no el QR solo: el aviso va en absoluto
          debajo (no entra en el flujo) y el `paddingBottom` le reserva su lugar, más
          un pequeño corrimiento óptico hacia arriba. El error sí va en flujo (tiene
          un botón, y un hijo fuera de los límites del padre no recibe toques en
          Android) -- en ese caso no hay QR que centrar. */}
      <View
        className="flex-1 items-center justify-center gap-6"
        style={!error && qrPayload ? styles.centerWithHint : undefined}
      >
        <View style={styles.qrAnchor}>
          <View testID="handshake-qr-box" style={styles.qrBox}>
            {showSpinner ? (
              <View style={styles.qrPlaceholder}>
                <ActivityIndicator size="large" color="#0A0A0B" />
                <Text className="mt-2 font-sans-medium text-[12px] text-ink-700">
                  Generando código seguro…
                </Text>
              </View>
            ) : qrPayload ? (
              <>
                <QRCode
                  value={qrPayload}
                  size={QR_SIZE}
                  color="#0A0A0B"
                  backgroundColor="#FFFFFF"
                  quietZone={6}
                  ecl="M"
                  testID="handshake-qr-code"
                />
                <View style={styles.centerLogoWrapper}>
                  <MovoIsotype
                    size={34}
                    variant="dark"
                    testID="handshake-qr-center-logo"
                  />
                </View>
              </>
            ) : (
              <View style={styles.qrPlaceholder}>
                <AlertCircle size={32} color="#8A8A8E" />
                <Text className="mt-2 text-center font-sans text-[12px] text-ink-500">
                  No se pudo cargar el QR
                </Text>
              </View>
            )}
          </View>

          {!error && qrPayload ? (
            <View
              pointerEvents="none"
              style={styles.hint}
              className="flex-row items-center justify-center gap-1.5"
            >
              <RefreshCw size={12} color={colors.fg3} />
              <Text
                testID="handshake-qr-auto-refresh-hint"
                className="font-sans text-[12px] text-fg-3"
              >
                El código se renueva solo por seguridad
              </Text>
            </View>
          ) : null}
        </View>

        {error ? (
          <View className="w-full gap-3">
            <View
              testID="handshake-qr-error"
              className="w-full flex-row items-center gap-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/30"
            >
              <AlertCircle size={16} color="#E5484D" />
              <Text className="flex-1 font-sans text-[12px] text-red-700 dark:text-red-300">
                {error}
              </Text>
            </View>
            <Pressable
              testID="handshake-qr-regenerate"
              onPress={handleRegenerate}
              disabled={isGenerating}
              className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-3.5 active:opacity-85"
            >
              <RefreshCw size={16} color="#0A0A0B" />
              <Text className="font-sans-semibold text-[14px] text-ink-950">
                Reintentar
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  qrAnchor: {
    alignSelf: "stretch",
    alignItems: "center",
  },
  hint: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    paddingTop: 20,
  },
  centerWithHint: {
    paddingBottom: HINT_HEIGHT + OPTICAL_LIFT,
  },
  qrBox: {
    width: QR_SIZE + 24,
    height: QR_SIZE + 24,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0A0A0B",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 10,
  },
  qrPlaceholder: {
    width: QR_SIZE,
    height: QR_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  centerLogoWrapper: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
});
