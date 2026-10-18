// Mock oficial de react-native-reanimated para Jest (MOVO-78, primer uso de
// reanimated en el repo) — sin esto, importar el módulo en tests revienta con
// "Cannot read properties of undefined (reading 'loadUnpackers')" porque no hay
// binding nativo de worklets disponible en el entorno de test.
//
// MOVO-301: el mock oficial no trae `useReducedMotion`; los tests lo controlan con
// `global.__reduceMotion` (por defecto, sin reducir movimiento).
jest.mock("react-native-reanimated", () => ({
  ...require("react-native-reanimated/mock"),
  useReducedMotion: () => Boolean(globalThis.__reduceMotion),
}));
