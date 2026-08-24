import { Tabs } from "expo-router";
import { FloatingTabBar } from "../../../components/tab-bar/floating-tab-bar";

/**
 * Navigator de tabs del área autenticada (MOVO-78): Inicio, Transportar, Ajustes.
 * Vive anidado dentro de `app/(app)/_layout.tsx` (el guard de sesión) — ese `Stack`
 * sigue igual, esta es simplemente una de sus rutas.
 *
 * `home` conserva su nombre de archivo (no `index`): un `index.tsx` acá adentro
 * resolvería al path `/` (los grupos `(app)`/`(tabs)` no aportan al URL) y
 * colisionaría con `app/index.tsx` (la bienvenida pública, también en `/`). Con
 * `home.tsx` el path sigue siendo `/home`, igual que antes de este ticket — no hace
 * falta tocar ningún `router.replace('/home')` existente.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" options={{ title: "Inicio" }} />
      <Tabs.Screen name="transport" options={{ title: "Transportar" }} />
      <Tabs.Screen name="profile" options={{ title: "Mi perfil" }} />
    </Tabs>
  );
}
