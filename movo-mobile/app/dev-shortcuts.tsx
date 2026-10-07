import { Redirect } from "expo-router";
import DevShortcutsScreen from "../components/dev/DevShortcutsScreen";

export default function DevShortcutsRoute() {
  if (!__DEV__) {
    return <Redirect href="/(app)/(tabs)/home" />;
  }
  return <DevShortcutsScreen />;
}
