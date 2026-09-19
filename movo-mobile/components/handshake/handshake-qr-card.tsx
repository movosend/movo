import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { RefreshCw, AlertCircle } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface HandshakeQrCardProps {
  qrPayload: string | null;
  secondsLeft: number;
  totalSeconds?: number;
  progressPercent: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
  isGenerating?: boolean;
  error?: string | null;
  counterpartName?: string;
  stage: "pickup" | "delivery" | null;
  onRegenerate: () => void;
  onSimulateScan?: () => void;
  testID?: string;
}

export function HandshakeQrCard({
  qrPayload,
  secondsLeft,
  progressPercent,
  isExpiringSoon,
  isExpired,
  isGenerating,
  error,
  counterpartName,
  stage,
  onRegenerate,
  onSimulateScan,
  testID = "handshake-qr-card",
}: HandshakeQrCardProps) {
  const colors = useThemeColors();

  const formattedTime = useMemo(() => {
    if (isExpired) return "00:00";
    return "00:" + String(Math.max(0, secondsLeft)).padStart(2, "0");
  }, [isExpired, secondsLeft]);

  const timeColor = isExpiringSoon
    ? "#E5484D"
    : colors.fg1;

  const barColor = isExpiringSoon
    ? "#E5484D"
    : "#C6F24A";

  const handleRegenerate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRegenerate();
  };

  const stageLabel = stage === "pickup" ? "el retiro" : "la entrega";
  const subtitle = counterpartName
    ? `${counterpartName} tiene que escanear este QR desde su app para confirmar ${stageLabel}.`
    : `La otra persona tiene que escanear este código desde su app para confirmar ${stageLabel}.`;

  return (
    <View testID={testID} className="w-full gap-4">
      {/* Cabecera / Instrucciones (Claude Design) */}
      <View className="gap-1.5 px-1">
        <Text className="font-sans-semibold text-[22px] tracking-tight text-fg">
          Mostrale el código
        </Text>
        <Text className="font-sans text-[14px] leading-relaxed text-fg-2">
          {subtitle}
        </Text>
      </View>

      {/* Tarjeta Principal del QR */}
      <View
        className="items-center gap-4 rounded-[14px] border border-border bg-bg-elevated p-6 shadow-sm"
        style={styles.cardContainer}
      >
        {/* Contenedor del QR y Logo Central */}
        <View
          testID="handshake-qr-box"
          className="relative items-center justify-center overflow-hidden rounded-xl bg-white p-2"
          style={[
            styles.qrBox,
            isExpired && styles.qrExpiredOpacity,
          ]}
        >
          {isGenerating ? (
            <View className="h-[186px] w-[186px] items-center justify-center">
              <ActivityIndicator size="large" color="#0A0A0B" />
              <Text className="mt-2 font-sans-medium text-[12px] text-ink-700">
                Generando código seguro…
              </Text>
            </View>
          ) : qrPayload ? (
            <>
              <QRCode
                value={qrPayload}
                size={186}
                color="#0A0A0B"
                backgroundColor="#FFFFFF"
                quietZone={6}
                ecl="M"
                testID="handshake-qr-code"
              />

              {/* Logo Central de Movo (Claude Design lines 453-457) */}
              <View style={styles.centerLogoWrapper}>
                <View style={styles.centerLogoCircle}>
                  <View style={styles.centerLogoDot} />
                </View>
              </View>
            </>
          ) : (
            <View className="h-[186px] w-[186px] items-center justify-center">
              <AlertCircle size={32} color={colors.fg3} />
              <Text className="mt-2 text-center font-sans text-[12px] text-fg-3">
                No se pudo cargar el QR
              </Text>
            </View>
          )}

          {isExpired && !isGenerating ? (
            <View
              testID="handshake-qr-expired-overlay"
              className="absolute inset-0 items-center justify-center bg-white/60"
            >
              <View className="rounded-full bg-red-100 px-3 py-1 dark:bg-red-950/40">
                <Text className="font-sans-semibold text-[11px] text-red-600 dark:text-red-400">
                  Código expirado
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Reloj Monospace y Barra de Progreso Regresiva */}
        <View className="w-full gap-2">
          <View className="flex-row items-center justify-center gap-1.5">
            <Text
              testID="handshake-qr-countdown-text"
              style={{ color: timeColor }}
              className="font-mono text-[13px] font-semibold tracking-wider"
            >
              {formattedTime}
            </Text>
          </View>

          {/* Barra de progreso */}
          <View className="h-1 w-full overflow-hidden rounded-full bg-bg-mute">
            <View
              testID="handshake-qr-progress-bar"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: barColor,
              }}
              className="h-full rounded-full"
            />
          </View>

          <Text className="text-center font-sans text-[11px] text-fg-3">
            {isExpired
              ? "Generá un código nuevo para seguir"
              : isExpiringSoon
                ? "A punto de vencer"
                : "Válido por 15 segundos"}
          </Text>
        </View>

        {/* Botón de Regeneración si está expirado */}
        {isExpired ? (
          <Pressable
            testID="handshake-qr-regenerate"
            onPress={handleRegenerate}
            disabled={isGenerating}
            className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-3.5 active:opacity-85"
          >
            <RefreshCw size={16} color="#0A0A0B" />
            <Text className="font-sans-semibold text-[14px] text-ink-950">
              Generar nuevo QR
            </Text>
          </Pressable>
        ) : null}

        {/* Error si ocurrió en el hook */}
        {error ? (
          <View
            testID="handshake-qr-error"
            className="w-full flex-row items-center gap-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/30"
          >
            <AlertCircle size={16} color="#E5484D" />
            <Text className="flex-1 font-sans text-[12px] text-red-700 dark:text-red-300">
              {error}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Herramientas de Desarrollo (__DEV__) */}
      {__DEV__ && qrPayload ? (
        <View className="gap-2 rounded-xl border border-dashed border-border bg-bg-mute/60 p-3">
          <Text className="font-sans-semibold text-[10px] uppercase tracking-wider text-fg-3">
            Simulación & Pruebas (Dev)
          </Text>
          <View className="gap-2">
            {onSimulateScan ? (
              <Pressable
                testID="handshake-qr-sim-scan"
                onPress={onSimulateScan}
                className="w-full items-center justify-center rounded-lg bg-bg-elevated border border-border py-2.5 active:opacity-75"
              >
                <Text className="font-sans-medium text-[12px] text-fg">
                  Simular escaneo receptor
                </Text>
              </Pressable>
            ) : null}
            <View className="w-full rounded-lg bg-bg-elevated p-2.5 border border-border">
              <Text className="font-sans text-[10px] text-fg-3 mb-1">Payload JSON (tocá para seleccionar):</Text>
              <Text
                testID="handshake-qr-payload-text"
                selectable
                numberOfLines={2}
                className="font-mono text-[11px] text-fg"
              >
                {qrPayload}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
  },
  qrBox: {
    width: 202,
    height: 202,
  },
  qrExpiredOpacity: {
    opacity: 0.2,
  },
  centerLogoWrapper: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  centerLogoCircle: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: "#0A0A0B",
    alignItems: "center",
    justifyContent: "center",
  },
  centerLogoDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: "#0A0A0B",
  },
});
