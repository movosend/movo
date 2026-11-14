import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * La pantalla "Seguimiento en vivo" se fue (MOVO-361): el seguimiento vive en el mapa del detalle y
 * su pantalla completa. Queda la ruta para no romper deep links ni pushes ya enviados: lleva al
 * detalle con el mapa abierto (`map=live`).
 */
export default function LegacyTrackingRedirect() {
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) return <Redirect href="/(app)/(tabs)/home" />;
  return <Redirect href={{ pathname: "/(app)/shipments/[id]", params: { id, map: "live" } }} />;
}
