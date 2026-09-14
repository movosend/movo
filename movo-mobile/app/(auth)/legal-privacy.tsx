import { router } from "expo-router";
import { LegalDocumentScreen } from "../../components/legal/legal-document-screen";
import { PRIVACY_POLICY_MARKDOWN } from "../../src/content/legal/politica-privacidad";

/** Espejo de Privacidad bajo `(auth)` — ver `legal-terms.tsx`. */
export default function AuthPrivacyScreen() {
  return (
    <LegalDocumentScreen
      title="Política de Privacidad"
      markdown={PRIVACY_POLICY_MARKDOWN}
      testID="auth-legal-privacy"
      onNavigateCrossDocument={() => router.push("/legal-terms" as any)}
    />
  );
}
