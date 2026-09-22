import { router } from "expo-router";
import { XCircle } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AcceptSuccessModal } from "../shipments/accept-success-modal";
import type { AttentionInfoTask, AttentionTask } from "../../src/hooks/use-attention-tasks";
import { useAttentionTasks } from "../../src/hooks/use-attention-tasks";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { AttentionConfirmCard } from "./attention-confirm-card";

function AttentionInfoCard({ task, testID }: { task: AttentionInfoTask; testID?: string }) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      onPress={task.onPress}
      className="flex-row items-center gap-3 rounded-[16px] border border-border bg-bg p-4"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-bg-mute">
        <XCircle size={20} color={colors.fg2} strokeWidth={1.8} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={2} className="font-sans-semibold text-small text-fg">
          {task.title}
        </Text>
        <Text numberOfLines={1} className="font-sans text-caption text-fg-2">
          {task.meta}
        </Text>
      </View>
      <Pressable
        testID={testID ? `${testID}-primary` : undefined}
        onPress={task.onPrimary}
        className="h-9 items-center justify-center rounded-full bg-fg px-4"
      >
        <Text className="font-sans-semibold text-caption text-bg">{task.primaryLabel}</Text>
      </Pressable>
    </Pressable>
  );
}

/**
 * Parte presentacional de "Requiere tu atención" (MOVO-193) — separada de
 * `AttentionSection` para poder reusarla desde `app/dev-home-operativo.tsx` (galería
 * de estados) con tareas fixture, sin duplicar el markup ni pasar por el hook real.
 * Sin tareas, no se renderiza.
 *
 * Rediseño de fidelidad visual (feedback del usuario: la card no tenía el ícono ni el
 * formato del diseño, y aceptar/rechazar debía usar el sheet real del detalle en vez
 * de un `Alert` genérico): ícono en círculo + título/meta, con dos tipos de card —
 * `AttentionInfoCard` (un solo botón inline, ej. "Ver envío") y `AttentionConfirmCard`
 * (Rechazar/Aceptar reales, MOVO-131/154). Tocar la card en cualquier lado que no sea
 * un botón navega al detalle; los botones son `Pressable`s anidados que no burbujean
 * ese tap, mismo criterio ya usado en `TripCard`/`ContactRow`.
 *
 * El modal de éxito de aceptar vive acá (no dentro de `AttentionConfirmCard`, bug de
 * review post-merge): aceptar invalida `["shipments","mine"]`, la tarea deja de
 * listarse en el próximo refetch y la card que la mostraba se desmonta — si el modal
 * viviera ahí adentro, se cerraría solo antes de que el usuario lo viera. Por eso el
 * `return null` de "sin tareas" no puede cortar la función entera: si se acepta la
 * última tarea pendiente, `tasks` llega vacío en el próximo render pero el modal
 * (que ya estaba abierto) tiene que seguir viéndose igual — se renderiza siempre,
 * fuera del `if`. Al cerrarlo, navega al detalle del envío — a diferencia del
 * detalle (`shipments/[id].tsx`, donde "Ver detalle" solo cierra el modal porque ya
 * estás viendo el envío), acá el copy "Ver detalle" tiene que llevar a algún lado de
 * verdad.
 */
export function AttentionTaskList({ tasks, testID }: { tasks: AttentionTask[]; testID?: string }) {
  const [acceptSuccessShipmentId, setAcceptSuccessShipmentId] = useState<string | null>(null);

  const handleDismissAcceptSuccess = () => {
    const shipmentId = acceptSuccessShipmentId;
    setAcceptSuccessShipmentId(null);
    if (shipmentId) {
      router.push(`/shipments/${shipmentId}`);
    }
  };

  const successModal = (
    <AcceptSuccessModal
      visible={!!acceptSuccessShipmentId}
      onDismiss={handleDismissAcceptSuccess}
      testID={testID ? `${testID}-accept-success-modal` : undefined}
    />
  );

  if (tasks.length === 0) {
    return successModal;
  }

  return (
    <View testID={testID} className="mb-6 gap-2.5">
      <Text className="font-sans-medium text-caption uppercase text-fg-3">
        Requiere tu atención
      </Text>
      {tasks.map((task) => {
        const taskTestID = testID ? `${testID}-task-${task.id}` : undefined;
        return task.kind === "confirm" ? (
          <AttentionConfirmCard
            key={task.id}
            task={task}
            onAcceptSuccess={() => setAcceptSuccessShipmentId(task.shipmentId)}
            testID={taskTestID}
          />
        ) : (
          <AttentionInfoCard key={task.id} task={task} testID={taskTestID} />
        );
      })}

      {successModal}
    </View>
  );
}

/**
 * "Requiere tu atención" (MOVO-193): interacciones que dependen de otra persona, no
 * del estado propio del envío en curso — ver `use-attention-tasks.ts` para qué se
 * deriva hoy y qué queda pendiente de un endpoint nuevo.
 */
export function AttentionSection({ testID }: { testID?: string }) {
  const { tasks } = useAttentionTasks();
  return <AttentionTaskList tasks={tasks} testID={testID} />;
}
