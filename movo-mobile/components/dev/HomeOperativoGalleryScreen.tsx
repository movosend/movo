import { KycStatus } from "@movo/shared/dist/types/user";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AttentionTaskList } from "../home/attention-section";
import { HomeSendCta } from "../home/home-send-cta";
import { RoleSection } from "../home/role-section";
import {
  MOCK_ATTENTION_TASKS,
  MOCK_RECEIVING_SHIPMENTS,
  MOCK_SENDING_SHIPMENTS,
} from "../../src/dev/home-operativo-fixtures";

/**
 * Galería de estados del home operativo (MOVO-193) — mismo layout y mismos
 * componentes que `app/(app)/(tabs)/home.tsx` (`RoleSection`, `HomeSendCta`,
 * `AttentionTaskList`), pero con fixtures locales en vez de los hooks reales
 * (`useSendingShipments`/`useReceivingShipments`/`useAttentionTasks`) — sirve para
 * ver todos los estados de la matriz del AC5 (assigned_unfunded/assigned/in_transit
 * × badges "Hoy"/"Ventana vencida") sin depender de MOVO-192 (backend Todo) ni de
 * llegar a esos estados a mano con datos reales.
 *
 * `RecentShipmentsSection`/`ViewAllShipmentsLink` (MOVO-83/113) no se replican acá:
 * son hook-driven sin forma de inyectarles datos y no son parte de lo que construyó
 * esta US — se verifican en `/home` con una sesión real, no en esta galería.
 *
 * Ruta: `/dev-home-operativo` (sin link desde la app, igual que `/dev-tokens` y
 * `/dev-connection` — se navega escribiendo la URL en el dev client).
 */
export default function HomeOperativoGalleryScreen() {
  const [hasData, setHasData] = useState(true);

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView className="border-b border-border bg-bg-sub" edges={["top"]}>
        <View className="gap-3 px-6 pb-4 pt-3">
          <Text className="font-sans-semibold text-title text-fg">Home operativo — galería</Text>
          <View className="flex-row gap-2">
            <Pressable
              testID="dev-home-toggle-data"
              onPress={() => setHasData(true)}
              className={`h-8 items-center justify-center rounded-full px-3 ${hasData ? "bg-ink-950" : "border border-border bg-bg"}`}
            >
              <Text className={`font-sans-medium text-small ${hasData ? "text-paper" : "text-fg-2"}`}>
                Con datos
              </Text>
            </Pressable>
            <Pressable
              testID="dev-home-toggle-empty"
              onPress={() => setHasData(false)}
              className={`h-8 items-center justify-center rounded-full px-3 ${!hasData ? "bg-ink-950" : "border border-border bg-bg"}`}
            >
              <Text className={`font-sans-medium text-small ${!hasData ? "text-paper" : "text-fg-2"}`}>
                Sin envíos activos
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerClassName="px-6 pb-16 pt-6" showsVerticalScrollIndicator={false}>
        <RoleSection
          testID="dev-home-sending"
          title="Estoy enviando"
          role="sending"
          shipments={hasData ? MOCK_SENDING_SHIPMENTS : []}
        />
        <RoleSection
          testID="dev-home-receiving"
          title="Voy a recibir"
          role="receiving"
          shipments={hasData ? MOCK_RECEIVING_SHIPMENTS : []}
        />

        <HomeSendCta testID="dev-home-send-cta" kycStatus={KycStatus.APPROVED} />

        <AttentionTaskList
          testID="dev-home-attention"
          tasks={hasData ? MOCK_ATTENTION_TASKS : []}
        />

        <View className="mt-2 rounded-[14px] border border-dashed border-border p-4">
          <Text className="font-sans text-small text-fg-3">
            Debajo, en el home real, siguen "Actividad reciente" y "Ver todos mis
            envíos" (MOVO-83/113) — no se replican en esta galería porque no tienen
            forma de recibir datos fixture; se prueban en /home con una sesión real.
          </Text>
        </View>

        <Link
          href="/dev-tokens"
          className="mt-4 font-sans text-small text-fg-3 underline"
          testID="dev-home-go-tokens"
        >
          Ver tokens de diseño →
        </Link>
      </ScrollView>
    </View>
  );
}
