import { useCallback, useRef } from "react";
import { Linking, ScrollView } from "react-native";
import { CROSS_DOCUMENT_KIND, type LegalDocumentKind } from "../lib/legal-acceptance";

const SCROLL_TOP_PADDING = 12;

/**
 * Extraído de `legal-document-screen.tsx` (MOVO-224/229) para reusarlo también en
 * `legal-document-sheet.tsx`: resuelve las tres clases de enlace que puede mandar un
 * documento legal (ancla interna del índice, referencia cruzada al otro documento,
 * o un link externo/`mailto:` de verdad), sin acoplarse a CÓMO se navega al otro
 * documento — eso lo decide el caller vía `onCrossDocument` (la pantalla de `(auth)`
 * navega a la ruta hermana; el sheet del hub autenticado cambia de documento in
 * place, sin salir del sheet).
 */
export function useLegalDocumentLinks(onCrossDocument: (kind: LegalDocumentKind) => void) {
  const scrollRef = useRef<ScrollView>(null);
  const headingOffsets = useRef<Record<string, number>>({});

  const handleHeadingLayout = useCallback((slug: string, y: number) => {
    headingOffsets.current[slug] = y;
  }, []);

  const handleLinkPress = useCallback(
    (href: string) => {
      if (href.startsWith("#")) {
        const y = headingOffsets.current[href.slice(1)];
        if (y !== undefined) {
          scrollRef.current?.scrollTo({ y: Math.max(y - SCROLL_TOP_PADDING, 0), animated: true });
        }
        return;
      }
      const crossKind = CROSS_DOCUMENT_KIND[href];
      if (crossKind) {
        onCrossDocument(crossKind);
        return;
      }
      Linking.openURL(href).catch(() => {});
    },
    [onCrossDocument],
  );

  const resetScrollAndHeadings = useCallback(() => {
    headingOffsets.current = {};
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  return { scrollRef, handleHeadingLayout, handleLinkPress, resetScrollAndHeadings };
}
