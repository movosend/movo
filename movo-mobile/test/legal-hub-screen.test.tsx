import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { LEGAL_DOCUMENT_VERSIONS } from "@movo/shared/dist/config/legal";
import LegalHubScreen from "../app/(app)/profile/legal/index";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

const mockUseMyProfile = jest.fn();
const mockMutate = jest.fn();
const mockUseAcceptLegalDocuments = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => mockUseMyProfile(),
  useAcceptLegalDocuments: () => mockUseAcceptLegalDocuments(),
}));

const CURRENT_PROFILE = {
  termsAcceptedAt: "2026-09-13T12:00:00.000Z",
  termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
  privacyAcceptedAt: "2026-09-13T12:00:00.000Z",
  privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
};

/**
 * MOVO-224/228: el hub "Legal" reemplaza el placeholder de Perfil → Configuración.
 * MOVO-229 (rediseño Claude Design "Rediseño página Legal con estados de firma")
 * cambió el hub de una lista con navegación a rutas propias a tarjetas con badge de
 * estado que abren un sheet de lectura+aceptación (`legal-document-sheet.tsx`) sin
 * salir de la pantalla — por eso ya no se prueba `router.push` acá, sino que el
 * contenido correcto del documento aparece dentro del sheet.
 */
describe("LegalHubScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMyProfile.mockReturnValue({ data: CURRENT_PROFILE });
    mockUseAcceptLegalDocuments.mockReturnValue({ mutate: mockMutate, isPending: false });
  });

  it("vuelve atrás desde el header", async () => {
    const { getByTestId } = await render(<LegalHubScreen />);

    await fireEvent.press(getByTestId("legal-hub-back"));

    expect(router.back).toHaveBeenCalled();
  });

  it("muestra el badge 'Al día' y la firma real cuando ambos documentos están vigentes", async () => {
    const { getAllByText } = await render(<LegalHubScreen />);

    expect(getAllByText("Al día").length).toBe(2);
    expect(getAllByText(/13 de sept de 2026/).length).toBe(2);
  });

  it("muestra el badge 'Pendiente' y el CTA 'Leer y aceptar' cuando nunca se aceptó nada", async () => {
    mockUseMyProfile.mockReturnValue({
      data: { ...CURRENT_PROFILE, termsAcceptedAt: null, termsVersion: null },
    });

    const { getByText, getByTestId } = await render(<LegalHubScreen />);

    expect(getByText("Pendiente")).toBeTruthy();
    expect(getByTestId("legal-document-card-cta-terms")).toBeTruthy();
    expect(getByText("Leer y aceptar")).toBeTruthy();
  });

  it("muestra el badge 'Nueva versión' cuando se aceptó una versión vieja", async () => {
    mockUseMyProfile.mockReturnValue({
      data: { ...CURRENT_PROFILE, privacyVersion: "2020-01-01" },
    });

    const { getByText } = await render(<LegalHubScreen />);

    expect(getByText("Nueva versión")).toBeTruthy();
    expect(getByText("Revisar y aceptar")).toBeTruthy();
  });

  it("tocar la tarjeta de Privacidad abre el sheet mostrando el contenido de Privacidad, sin navegar", async () => {
    const { getByTestId, getAllByText } = await render(<LegalHubScreen />);

    await fireEvent.press(getByTestId("legal-document-card-cta-privacy"));

    expect(getByTestId("legal-document-sheet-privacy")).toBeTruthy();
    expect(getAllByText(/Tus derechos \(ARCO\)/).length).toBeGreaterThan(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("cerrar el sheet con la X no navega a ningún lado", async () => {
    const { getByTestId } = await render(<LegalHubScreen />);

    await fireEvent.press(getByTestId("legal-document-card-cta-terms"));
    await fireEvent.press(getByTestId("legal-document-sheet-close"));

    expect(router.push).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("oculta el botón volver atrás cuando hay documentos pendientes (bloqueante)", async () => {
    mockUseMyProfile.mockReturnValue({
      data: { ...CURRENT_PROFILE, termsAcceptedAt: null, termsVersion: null },
    });

    const { queryByTestId } = await render(<LegalHubScreen />);

    expect(queryByTestId("legal-hub-back")).toBeNull();
  });
});
