import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import AuthPrivacyScreen from "../app/(auth)/legal-privacy";
import AuthTermsScreen from "../app/(auth)/legal-terms";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

/**
 * MOVO-228: espejos de `app/(app)/profile/legal/*` bajo `(auth)`, para que el
 * checkbox de aceptación del wizard de registro pueda abrir el documento
 * completo antes de que exista una sesión (el guard de `(app)/_layout.tsx`
 * bloquearía las rutas equivalentes ahí). Mismo contenido, mismo componente
 * compartido (`LegalDocumentScreen`) — no se duplica cobertura de parsing acá,
 * eso ya lo cubre `markdown-lite.test.tsx` y `legal-document-screens.test.tsx`.
 */
describe("AuthTermsScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("muestra el título y vuelve atrás desde el header", async () => {
    const { getByText, getByTestId } = await render(<AuthTermsScreen />);

    expect(getByText("Términos y Condiciones")).toBeTruthy();

    await fireEvent.press(getByTestId("auth-legal-terms-back"));
    expect(router.back).toHaveBeenCalled();
  });
});

describe("AuthPrivacyScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("muestra el título y vuelve atrás desde el header", async () => {
    const { getByText, getByTestId } = await render(<AuthPrivacyScreen />);

    expect(getByText("Política de Privacidad")).toBeTruthy();

    await fireEvent.press(getByTestId("auth-legal-privacy-back"));
    expect(router.back).toHaveBeenCalled();
  });
});
