import React from "react";
import { Pressable, Text, View } from "react-native";
import { KeyRound, RefreshCw } from "lucide-react-native";

export interface HandshakeDeviceKeyWarningProps {
  status: "idle" | "pending" | "ready" | "error";
  onRetry: () => void;
  testID?: string;
}

export function HandshakeDeviceKeyWarning({
  status,
  onRetry,
  testID = "handshake-device-key-warning",
}: HandshakeDeviceKeyWarningProps) {
  if (status === "ready") return null;

  return (
    <View
      testID={testID}
      className="w-full max-w-[420px] self-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20"
    >
      <View className="flex-row items-center gap-2.5">
        <KeyRound size={18} color="#D97706" />
        <Text className="font-sans-semibold text-[13px] text-amber-900 dark:text-amber-200">
          Clave de seguridad del dispositivo
        </Text>
      </View>

      <Text className="font-sans text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
        {status === "pending"
          ? "Preparando la clave criptográfica de este dispositivo para la firma segura…"
          : "No se pudo sincronizar la clave de seguridad del dispositivo. Es requerida para firmar el código QR."}
      </Text>

      {status === "error" ? (
        <Pressable
          testID="handshake-device-key-retry"
          onPress={onRetry}
          className="flex-row items-center justify-center gap-2 rounded-lg bg-amber-600 py-2.5 active:opacity-85"
        >
          <RefreshCw size={14} color="#FFFFFF" />
          <Text className="font-sans-semibold text-[12px] text-white">
            Reintentar sincronización
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
