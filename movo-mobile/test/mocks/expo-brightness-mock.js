// El módulo nativo no existe en Jest. Mock global para que cualquier pantalla que
// muestre un QR (`useScanBrightness`) renderice sin configuración extra por test.
module.exports = {
  getBrightnessAsync: jest.fn(() => Promise.resolve(0.4)),
  setBrightnessAsync: jest.fn(() => Promise.resolve()),
  restoreSystemBrightnessAsync: jest.fn(() => Promise.resolve()),
};
