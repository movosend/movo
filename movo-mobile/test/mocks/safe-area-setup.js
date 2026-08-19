// `useSafeAreaInsets` (a diferencia de `<SafeAreaView>`) tira "No safe area value
// available" si no hay un `SafeAreaProvider` arriba — las pantallas se renderizan
// sueltas en los tests, sin el provider del layout raíz. El paquete ya trae un mock
// oficial con insets en 0, que es exactamente lo que queremos acá.
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);
