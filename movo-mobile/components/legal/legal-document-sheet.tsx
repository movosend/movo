import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { PrimaryButton } from "../auth/primary-button";
import { ErrorBanner } from "../ui/error-banner";
import { useAcceptLegalDocuments } from "../../src/hooks/use-profile";
import { useLegalDocumentLinks } from "../../src/hooks/use-legal-document-links";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import {
  LEGAL_DOCUMENT_TITLES,
  getAcceptanceState,
  legalAcceptanceMeta,
  type LegalDocumentKind,
} from "../../src/lib/legal-acceptance";
import { PRIVACY_POLICY_MARKDOWN } from "../../src/content/legal/politica-privacidad";
import { TERMS_MARKDOWN } from "../../src/content/legal/terminos-y-condiciones";
import { MarkdownLite } from "./markdown-lite";

const MARKDOWN_BY_KIND: Record<LegalDocumentKind, string> = {
  terms: TERMS_MARKDOWN,
  privacy: PRIVACY_POLICY_MARKDOWN,
};

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

interface LegalDocumentSheetProps {
  visible: boolean;
  /** Documento con el que abre el sheet — "Ver también" dentro del contenido puede
   * cambiarlo sin cerrar el sheet (`useLegalDocumentLinks#onCrossDocument`). */
  initialKind: LegalDocumentKind;
  profile: PrivateProfile | undefined;
  onClose: () => void;
  testID?: string;
}

/**
 * Sheet de lectura + aceptación de un documento legal (MOVO-229, rediseño Claude
 * Design "Rediseño página Legal con estados de firma") — reemplaza la navegación a
 * `/profile/legal/terms`/`privacy` (pantallas borradas) por un sheet inferior, fiel
 * al prototipo (`showDocModal`).
 *
 * **"Ver también" cambia de documento SIN salir del sheet** (`kind` es estado local,
 * no la ruta): la alternativa —navegar a otra pantalla— reabriría el problema que ya
 * evitan las pantallas de `(auth)` (una referencia cruzada al documento del hub
 * autenticado queda detrás del guard de sesión), y además rompería la sensación de
 * "estoy leyendo un documento legal" al meter una transición de navegación completa
 * en el medio. Al cambiar de documento se resetea el scroll y las anclas del índice
 * (`resetScrollAndHeadings`) — son coordenadas del documento anterior, no sirven
 * para el nuevo.
 */
export function LegalDocumentSheet({ visible, initialKind, profile, onClose, testID = "legal-document-sheet" }: LegalDocumentSheetProps) {
  const colors = useThemeColors();
  const [kind, setKind] = useState<LegalDocumentKind>(initialKind);
  const [error, setError] = useState<string | null>(null);
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  const acceptMutation = useAcceptLegalDocuments();

  const { scrollRef, handleHeadingLayout, handleLinkPress, resetScrollAndHeadings } = useLegalDocumentLinks(
    (nextKind) => {
      resetScrollAndHeadings();
      setKind(nextKind);
      setError(null);
    },
  );

  // Cada apertura nueva arranca en el documento que se tocó desde el hub, no en el
  // que haya quedado de la última vez que se abrió (p. ej. tras un "Ver también").
  useEffect(() => {
    if (visible) {
      setKind(initialKind);
      setError(null);
    }
  }, [visible, initialKind]);

  const state = getAcceptanceState(kind, profile);
  const meta = legalAcceptanceMeta(state);
  const title = LEGAL_DOCUMENT_TITLES[kind];

  const handleAccept = () => {
    setError(null);
    const payload = kind === "terms" ? { termsVersion: state.currentVersion } : { privacyVersion: state.currentVersion };
    acceptMutation.mutate(payload, {
      onError: (err) => setError(friendlyErrorMessage(err, "No pudimos registrar la aceptación. Intentá de nuevo.")),
    });
  };

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={onClose}
      testID={testID}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable testID={`${testID}-backdrop`} onPress={onClose} className="flex-1 bg-black/40" />
          </Animated.View>
          <View className="flex-1 justify-end" pointerEvents="box-none">
            <Animated.View style={[sheetStyle, { maxHeight: "82%" }]}>
              <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]} style={{ maxHeight: "100%" }}>
                <View className="items-center pb-1.5 pt-3">
                  <View className="h-1 w-9 rounded-full bg-border" />
                </View>

                <View className="flex-row items-start justify-between px-5 pb-3 pt-1">
                  <View className="flex-1 pr-3">
                    <Text className="font-sans-semibold text-h3 text-fg" numberOfLines={2}>
                      {title}
                    </Text>
                    <Text className="mt-0.5 font-sans text-[12px] text-fg-3">Versión {state.currentVersion}</Text>
                  </View>
                  <Pressable
                    testID={`${testID}-close`}
                    onPress={onClose}
                    className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
                  >
                    <X size={15} color={colors.fg1} strokeWidth={2} />
                  </Pressable>
                </View>

                <ScrollView
                  ref={scrollRef}
                  testID={`${testID}-content`}
                  contentContainerClassName="px-5 pb-6"
                  showsVerticalScrollIndicator={false}
                >
                  <MarkdownLite
                    source={MARKDOWN_BY_KIND[kind]}
                    testID={`${testID}-${kind}`}
                    onLinkPress={handleLinkPress}
                    onHeadingLayout={handleHeadingLayout}
                  />
                </ScrollView>

                {error ? (
                  <View className="px-5 pt-3">
                    <ErrorBanner message={error} testID={`${testID}-error`} />
                  </View>
                ) : null}

                {meta.cardCtaFilled ? (
                  <PrimaryButton
                    testID={`${testID}-accept`}
                    label={meta.acceptButtonLabel}
                    onPress={handleAccept}
                    loading={acceptMutation.isPending}
                    variant="lime"
                  />
                ) : (
                  <PrimaryButton testID={`${testID}-done`} label="Cerrar" onPress={onClose} variant="dark" />
                )}
              </SafeAreaView>
            </Animated.View>
          </View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
