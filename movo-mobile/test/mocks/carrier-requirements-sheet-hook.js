/**
 * Doble de `useCarrierRequirementsSheet` para los tests de pantalla (MOVO-117): el hook real
 * necesita `QueryClientProvider` y los hooks de perfil/MP, que no tienen que ver con lo que
 * esas pantallas testean. Conserva lo que sí importa: decide por `code` con el helper real
 * (`carrierRequirementsFromError`) y abre la checklist real con los faltantes del error.
 *
 *   jest.mock("../src/hooks/use-carrier-requirements-sheet", () =>
 *     require("./mocks/carrier-requirements-sheet-hook"));
 */
const React = require("react");
const { carrierRequirementsFromError } = require("../../src/lib/carrier-requirements");

const mockPressLicense = jest.fn();
const mockPressMp = jest.fn();

function useCarrierRequirementsSheet(context) {
  const [missing, setMissing] = React.useState(null);
  const handleError = React.useCallback((error) => {
    const required = carrierRequirementsFromError(error);
    if (!required) return false;
    setMissing(required);
    return true;
  }, []);
  return {
    handleError,
    sheetProps: {
      visible: missing !== null,
      onClose: () => setMissing(null),
      missing: missing ?? [],
      licenseStatus: "not_started",
      mpStatus: "unlinked",
      context,
      onPressLicense: mockPressLicense,
      onPressMp: mockPressMp,
    },
  };
}

module.exports = { useCarrierRequirementsSheet, mockPressLicense, mockPressMp };
