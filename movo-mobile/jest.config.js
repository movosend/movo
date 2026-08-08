module.exports = {
  preset: "jest-expo",
  transform: {
    "\\.[jt]sx?$": "babel-jest",
    "\\.mjs$": "babel-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|@react-navigation/.*|react-navigation|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|standard-navigation|expo-modules-core|lucide-react-native)",
  ],
  moduleNameMapper: {
    "\\.css$": "<rootDir>/test/mocks/style-mock.js",
  },
};
