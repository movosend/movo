import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { LEGAL_DOCUMENT_VERSIONS } from "@movo/shared/dist/config/legal";
import { LegalDocumentSheet } from "../components/legal/legal-document-sheet";

const mockMutate = jest.fn();
const mockUseAcceptLegalDocuments = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  useAcceptLegalDocuments: () => mockUseAcceptLegalDocuments(),
}));

const CURRENT_PROFILE = {
  termsAcceptedAt: null,
  termsVersion: null,
  privacyAcceptedAt: "2026-01-01T12:00:00.000Z",
  privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
} as any;

/** MOVO-229 (rediseño Claude Design): sheet de lectura + aceptación por documento,
 * reemplaza la navegación a `/profile/legal/terms`/`privacy`. */
describe("LegalDocumentSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAcceptLegalDocuments.mockReturnValue({ mutate: mockMutate, isPending: false });
  });

  it("muestra el botón 'Acepto' y llama a la mutación con termsVersion al aceptar Términos pendientes", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <LegalDocumentSheet visible initialKind="terms" profile={CURRENT_PROFILE} onClose={onClose} />,
    );

    expect(getByTestId("legal-document-sheet-accept")).toBeTruthy();
    fireEvent.press(getByTestId("legal-document-sheet-accept"));

    expect(mockMutate).toHaveBeenCalledWith(
      { termsVersion: LEGAL_DOCUMENT_VERSIONS.terms },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("con un documento ya al día muestra 'Cerrar' en vez de un botón de aceptar", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <LegalDocumentSheet visible initialKind="privacy" profile={CURRENT_PROFILE} onClose={onClose} />,
    );

    expect(getByTestId("legal-document-sheet-done")).toBeTruthy();
    fireEvent.press(getByTestId("legal-document-sheet-done"));

    expect(onClose).toHaveBeenCalled();
  });

  it("muestra el error de la mutación si falla la aceptación", async () => {
    mockMutate.mockImplementation((_payload, { onError }) => onError(new Error("boom")));
    const { getByTestId } = await render(
      <LegalDocumentSheet visible initialKind="terms" profile={CURRENT_PROFILE} onClose={jest.fn()} />,
    );

    fireEvent.press(getByTestId("legal-document-sheet-accept"));

    await waitFor(() => expect(getByTestId("legal-document-sheet-error")).toBeTruthy());
  });

  it("'Ver también' cambia de documento sin cerrar el sheet ni navegar", async () => {
    const { getByTestId, getAllByText } = await render(
      <LegalDocumentSheet visible initialKind="terms" profile={CURRENT_PROFILE} onClose={jest.fn()} />,
    );

    expect(getByTestId("legal-document-sheet-terms")).toBeTruthy();

    await fireEvent.press(getAllByText("Política de Privacidad")[0]);

    await waitFor(() => expect(getByTestId("legal-document-sheet-privacy")).toBeTruthy());
  });

  it("la X cierra el sheet", async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <LegalDocumentSheet visible initialKind="terms" profile={CURRENT_PROFILE} onClose={onClose} />,
    );

    fireEvent.press(getByTestId("legal-document-sheet-close"));

    expect(onClose).toHaveBeenCalled();
  });
});
