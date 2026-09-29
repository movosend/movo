// `expo-image` no se puede importar en Jest: al cargarse invoca la integración con
// `expo-observe`, y el mock automático de módulos nativos de jest-expo no implementa
// `getIntegrations`. Se reemplaza por una `View` que conserva las props (`source`,
// `onLoad`, `onError`...) para poder verificarlas o disparar la carga con `fireEvent`.
const React = require("react");
const { View } = require("react-native");

function Image(props) {
  return React.createElement(View, props);
}
Image.prefetch = jest.fn(() => Promise.resolve(true));
Image.clearDiskCache = jest.fn(() => Promise.resolve(true));
Image.clearMemoryCache = jest.fn(() => Promise.resolve(true));

module.exports = { Image, ImageBackground: Image };
