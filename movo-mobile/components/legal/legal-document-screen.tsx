import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { ScrollView, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLegalDocumentLinks } from "../../src/hooks/use-legal-document-links";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { MarkdownLite } from "./markdown-lite";

interface LegalDocumentScreenProps {
  title: string;
  markdown: string;
  testID: string;
  /** A dónde ir al tocar la referencia cruzada al otro documento ("Ver también:
   * [...]") — esta pantalla vive bajo `(auth)` (registro, sin sesión todavía), así
   * que siempre navega a la pantalla hermana de `(auth)`, nunca a la del hub
   * autenticado (bloqueada por el guard de `(app)/_layout.tsx`). */
  onNavigateCrossDocument: () => void;
}

/**
 * Shell de lectura a pantalla completa, hoy usado solo por las dos pantallas espejo
 * de `(auth)` (`legal-terms.tsx`/`legal-privacy.tsx`, MOVO-224/228) — el checkbox
 * del wizard de registro necesita poder abrir el documento completo antes de que
 * exista una sesión. El hub autenticado (`profile/legal/index.tsx`, MOVO-229) usa en
 * su lugar `legal-document-sheet.tsx`, que agrega el estado de aceptación y el botón
 * de aceptar — acá no hace falta ninguno de los dos, el registro acepta por el
 * checkbox del wizard, no por acá.
 */
export function LegalDocumentScreen({ title, markdown, testID, onNavigateCrossDocument }: LegalDocumentScreenProps) {
  const colors = useThemeColors();
  const { scrollRef, handleHeadingLayout, handleLinkPress } = useLegalDocumentLinks(() => onNavigateCrossDocument());

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID={`${testID}-back`}
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="flex-1 font-sans-semibold text-h3 text-fg" numberOfLines={1}>
          {title}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        testID={`${testID}-content`}
        contentContainerClassName="px-5 pb-12"
        showsVerticalScrollIndicator={false}
      >
        <MarkdownLite
          source={markdown}
          testID={testID}
          onLinkPress={handleLinkPress}
          onHeadingLayout={handleHeadingLayout}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
