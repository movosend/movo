import { router } from "expo-router";
import { LegalDocumentScreen } from "../../components/legal/legal-document-screen";
import { TERMS_MARKDOWN } from "../../src/content/legal/terminos-y-condiciones";

/**
 * Espejo de la vista de Términos del hub autenticado (MOVO-224) bajo `(auth)` — el
 * checkbox de aceptación del registro (MOVO-228) necesita poder abrir el documento
 * completo antes de que exista una sesión. Mismo contenido, mismo componente
 * compartido — dos rutas, no dos documentos.
 */
export default function AuthTermsScreen() {
  return (
    <LegalDocumentScreen
      title="Términos y Condiciones"
      markdown={TERMS_MARKDOWN}
      testID="auth-legal-terms"
      onNavigateCrossDocument={() => router.push("/legal-privacy" as any)}
    />
  );
}
