// Mock de `react-native-maps` para Jest — el módulo nativo (`RNMapsAirModule`) no
// existe en el entorno de test (jsdom/jest-expo), igual que `react-native-reanimated`
// necesita su propio setup (`reanimated-setup.js`). `MapView`/`Marker` se mockean como
// `View`s planas: los tests de pantallas con mapa (wizard de envíos, MOVO-83) verifican
// comportamiento de negocio, no el renderizado nativo del mapa en sí.
const React = require("react");
const { View } = require("react-native");

function MapView(props) {
  return React.createElement(View, { testID: props.testID }, props.children);
}

function Marker(props) {
  return React.createElement(View, { testID: props.testID }, props.children);
}

module.exports = {
  __esModule: true,
  default: MapView,
  Marker,
  PROVIDER_GOOGLE: "google",
};
