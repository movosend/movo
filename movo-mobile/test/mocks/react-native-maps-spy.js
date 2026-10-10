// Variante espía del mock de `react-native-maps` (ver `react-native-maps-mock.js`): expone
// `fitToCoordinates` y los `tracksViewChanges` de cada Marker para tests de comportamiento del mapa.
const React = require("react");
const { View } = require("react-native");

const spy = { fit: jest.fn(), tracks: [] };

const MapView = React.forwardRef(function MapView(props, ref) {
  React.useImperativeHandle(ref, () => ({ fitToCoordinates: spy.fit, animateToRegion: () => {} }));
  React.useEffect(() => {
    if (props.onMapReady) props.onMapReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return React.createElement(View, null, props.children);
});

function Marker(props) {
  spy.tracks.push(props.tracksViewChanges);
  return React.createElement(View, null, props.children);
}

module.exports = { __esModule: true, default: MapView, Marker, Polyline: () => null, PROVIDER_GOOGLE: "google", spy };
