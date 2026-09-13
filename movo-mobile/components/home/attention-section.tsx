import { Pressable, Text, View } from "react-native";
import type { AttentionTask } from "../../src/hooks/use-attention-tasks";
import { useAttentionTasks } from "../../src/hooks/use-attention-tasks";

/**
 * Parte presentacional de "Requiere tu atención" (MOVO-193) — separada de
 * `AttentionSection` para poder reusarla desde `app/dev-home-operativo.tsx` (galería
 * de estados) con tareas fixture, sin duplicar el markup ni pasar por el hook real.
 * Sin tareas, no se renderiza.
 */
export function AttentionTaskList({ tasks, testID }: { tasks: AttentionTask[]; testID?: string }) {
  if (tasks.length === 0) return null;

  return (
    <View testID={testID} className="mb-6 gap-2.5">
      <Text className="font-sans-medium text-caption uppercase text-fg-3">
        Requiere tu atención
      </Text>
      {tasks.map((task) => (
        <View
          key={task.id}
          className="flex-row items-center gap-3 rounded-[14px] border border-border bg-bg-sub p-3.5"
        >
          <View className="flex-1 gap-0.5">
            <Text numberOfLines={1} className="font-sans-semibold text-small text-fg">
              {task.title}
            </Text>
            <Text numberOfLines={1} className="font-sans text-caption text-fg-2">
              {task.meta}
            </Text>
          </View>
          <Pressable
            testID={testID ? `${testID}-task-${task.id}` : undefined}
            onPress={task.onPrimary}
            className="h-9 items-center justify-center rounded-full bg-ink-950 px-4"
          >
            <Text className="font-sans-semibold text-caption text-paper">{task.primaryLabel}</Text>
          </Pressable>
        </View>
      ))}
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
