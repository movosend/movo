module.exports = {
  preset: "jest-expo",
  // Resolver custom de react-native-worklets (dependencia de reanimated 4, MOVO-78):
  // sin esto, Jest resuelve `NativeWorklets.native.ts` (que llama al módulo nativo
  // real, inexistente en el entorno de test) en vez del stub no-nativo — falla con
  // "Cannot read properties of undefined (reading 'loadUnpackers')" incluso con el
  // mock de `react-native-reanimated` puesto, porque el propio mock importa el
  // inicializador real de reanimated/worklets internamente.
  resolver: "react-native-worklets/jest/resolver.js",
  setupFiles: ["<rootDir>/test/mocks/reanimated-setup.js"],
  transform: {
    "\\.[jt]sx?$": "babel-jest",
    "\\.mjs$": "babel-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|@react-navigation/.*|react-navigation|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|standard-navigation|expo-modules-core|lucide-react-native)",
  ],
  moduleNameMapper: {
    "\\.css$": "<rootDir>/test/mocks/style-mock.js",
    "^react-native-maps$": "<rootDir>/test/mocks/react-native-maps-mock.js",
  },
};
