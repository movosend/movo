import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SkeletonBlock as Block } from "../ui/skeleton-block";

/** Estado de carga del perfil (MOVO-78 AC8) — bloques estáticos imitando la forma de
 * cada sección, sin librería de shimmer nueva. */
export function ProfileSkeleton({ testID }: { testID?: string }) {
  return (
    <SafeAreaView testID={testID} className="flex-1 bg-bg px-6 pt-8" edges={["top"]}>
      <View className="mb-6 flex-row items-center gap-3">
        <Block className="h-14 w-14 rounded-full" />
        <Block className="h-6 w-40 rounded-md" />
      </View>
      <Block className="mb-5 h-24 rounded-[10px]" />
      <View className="mb-5 flex-row gap-2.5">
        <Block className="h-20 flex-1 rounded-[10px]" />
        <Block className="h-20 flex-1 rounded-[10px]" />
        <Block className="h-20 flex-1 rounded-[10px]" />
      </View>
      <Block className="mb-2.5 h-10 w-32 rounded-md" />
      <View className="gap-2">
        <Block className="h-12 rounded-[10px]" />
        <Block className="h-12 rounded-[10px]" />
      </View>
    </SafeAreaView>
  );
}
