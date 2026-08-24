// Mock oficial de react-native-reanimated para Jest (MOVO-78, primer uso de
// reanimated en el repo) — sin esto, importar el módulo en tests revienta con
// "Cannot read properties of undefined (reading 'loadUnpackers')" porque no hay
// binding nativo de worklets disponible en el entorno de test.
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
