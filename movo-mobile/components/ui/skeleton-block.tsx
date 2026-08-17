import { View, type ViewProps } from "react-native";

/** Bloque estático imitando la forma de un elemento en carga (perfil, MOVO-78 AC8;
 * receptor/avatar, MOVO-83) — sin librería de shimmer nueva, mismo criterio que
 * `ProfileSkeleton`. Extraído de ahí para no duplicar el mismo `<View className=
 * "bg-bg-mute" />` cada vez que se necesita un placeholder de carga. */
export function SkeletonBlock({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={`bg-bg-mute ${className ?? ""}`} {...props} />;
}
