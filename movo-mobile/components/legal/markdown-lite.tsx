import { Fragment, type ReactNode } from "react";
import { Text, View } from "react-native";

type Block =
  | { type: "meta"; pairs: { label: string; value: string }[] }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "rule" };

/**
 * Deriva un ancla estable a partir de un título de sección ("1. Quiénes somos
 * y alcance de esta política" → "quienes-somos-y-alcance-de-esta-politica").
 * Es la bisagra entre el índice (`## 0. Índice`, una lista numerada con el
 * mismo texto que cada encabezado, sin el número) y los encabezados reales:
 * ambos se pasan por esta misma función, así que matchean sin tener que
 * escribir anclas a mano en el markdown fuente (y sin riesgo de que se
 * desincronicen si el título de una sección cambia — el índice se recalcula
 * solo).
 */
function slugify(text: string): string {
  return text
    .replace(/^\d+\.\s*/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parser de markdown liviano, a propósito acotado a lo que realmente usan
 * `docs/legal/politica-privacidad.md` y `docs/legal/terminos-y-condiciones.md`
 * (MOVO-224): metadata del encabezado (`**Label**: valor`), títulos `##`/`###`,
 * párrafos, listas `-`/numeradas, blockquotes `>`, tablas `| a | b |` y `---`.
 * No es un parser de markdown genérico: si el contenido fuente crece con
 * sintaxis nueva, este archivo necesita crecer con él.
 */
export function parseMarkdownLite(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
  const isTableSeparator = (line: string) => /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
  const splitRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const metaLineRegex = /^\*\*(.+?)\*\*:\s*(.*)$/;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "" || line.trim() === "---") {
      if (line.trim() === "---") blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    // Bloque de metadata del documento (Versión/Última actualización/Vigencia):
    // solo se reconoce como tal al principio del documento, para no capturar
    // ningún otro "**Frase corta**: resto del párrafo" que aparezca más abajo
    // (esos son intros en negrita de un párrafo normal, no metadata).
    if (blocks.length === 0 && metaLineRegex.test(line)) {
      const pairs: { label: string; value: string }[] = [];
      while (i < lines.length) {
        if (lines[i].trim() === "") {
          let j = i;
          while (j < lines.length && lines[j].trim() === "") j += 1;
          if (j < lines.length && metaLineRegex.test(lines[j])) {
            i = j;
            continue;
          }
          break;
        }
        const match = metaLineRegex.exec(lines[i]);
        if (!match) break;
        pairs.push({ label: match[1], value: match[2] });
        i += 1;
      }
      blocks.push({ type: "meta", pairs });
      continue;
    }

    const headingMatch = /^(#{2,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length === 2 ? 2 : 3,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    // `# Título` de portada — se ignora, cada pantalla ya pone su propio título.
    if (/^#\s+/.test(line)) {
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    if (isTableRow(line) && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const isListMarker = (l: string) => /^-\s+/.test(l) || /^\d+\.\s+/.test(l);
    if (isListMarker(line)) {
      const items: string[] = [];
      while (i < lines.length && (isListMarker(lines[i]) || (lines[i].trim() !== "" && !/^[-#>|]/.test(lines[i]) && items.length > 0))) {
        if (isListMarker(lines[i])) {
          items.push(lines[i].replace(/^-\s+/, "").replace(/^\d+\.\s+/, ""));
        } else {
          items[items.length - 1] += ` ${lines[i].trim()}`;
        }
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Párrafo: junta líneas consecutivas no vacías hasta el próximo separador.
    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      lines[i].trim() !== "---" &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !/^-\s+/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

const INLINE_REGEX = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/**
 * Divide un fragmento de texto en spans de texto plano / negrita / código en
 * línea / enlace. `onLinkPress` decide qué hacer con cada enlace (ancla
 * interna, `mailto:`, referencia cruzada al otro documento, o una URL
 * externa) — esa decisión es responsabilidad de quien use `MarkdownLite`, acá
 * solo se reconoce y se hace tocable.
 *
 * La itálica (`*texto*`) se resuelve por separado, ANTES de este split, y de
 * forma recursiva: en los dos documentos fuente solo aparece envolviendo una
 * línea entera que a su vez contiene un enlace ("*Ver también:
 * [Política de Privacidad](...).*") — si `*...*` entrara como una alternativa
 * más del regex de abajo, su patrón `[^*]+` (codicioso) se tragaría el enlace
 * completo como texto plano antes de que el enlace tuviera chance de
 * matchear, dejándolo roto. Resolverla afuera y volver a llamar a esta misma
 * función sobre el contenido interior evita ese conflicto sin necesitar un
 * parser recursivo genérico para todo lo demás.
 */
function renderInline(text: string, keyPrefix: string, onLinkPress?: (href: string) => void): ReactNode[] {
  if (text.startsWith("*") && !text.startsWith("**") && text.endsWith("*") && text.length > 1) {
    return [
      <Text key={`${keyPrefix}-italic`} className="italic text-fg-3">
        {renderInline(text.slice(1, -1), `${keyPrefix}-italic`, onLinkPress)}
      </Text>,
    ];
  }

  const parts = text.split(INLINE_REGEX).filter((part) => part !== "");
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={key} className="font-sans-semibold text-fg">
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={key} className="font-mono text-[13px] text-fg-2">
          {part.slice(1, -1)}
        </Text>
      );
    }
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      return (
        <Text
          key={key}
          suppressHighlighting
          onPress={onLinkPress ? () => onLinkPress(href) : undefined}
          className="font-sans-medium text-fg underline"
        >
          {label}
        </Text>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

interface MarkdownLiteProps {
  source: string;
  testID?: string;
  /** Se llama con `#ancla`, `mailto:...`, `./otro-documento.md` o una URL externa. */
  onLinkPress?: (href: string) => void;
  /** Reporta el offset vertical (relativo al contenedor del documento) de cada
   * encabezado apenas termina de dibujarse, para que el índice pueda hacer scroll. */
  onHeadingLayout?: (slug: string, y: number) => void;
}

/**
 * Render de solo lectura para los documentos legales de MOVO-224. Sin librería
 * de markdown nueva a propósito (mismo criterio que el resto del repo evita
 * dependencias para un solo uso, ver `profile-settings-section.tsx`) — el
 * contenido fuente es acotado y controlado por el propio equipo, no markdown
 * arbitrario de un tercero.
 *
 * Las tablas del documento fuente (2-4 columnas) se re-interpretan como una
 * lista de tarjetas apiladas, una fila por tarjeta con "columna: valor" — una
 * tabla ancha de verdad no entra en un teléfono sin scroll horizontal.
 *
 * El índice (`## 0. Índice`) es una lista numerada común y corriente en el
 * markdown fuente, sin sintaxis de enlace — se vuelve tocable automáticamente
 * acá comparando el texto de cada ítem (slugificado) contra el de cada
 * encabezado del documento. Ningún otro tipo de lista del contenido coincide
 * con un encabezado real, así que esto no interfiere con listas normales.
 */
export function MarkdownLite({ source, testID, onLinkPress, onHeadingLayout }: MarkdownLiteProps) {
  const blocks = parseMarkdownLite(source);
  const headingSlugs = new Set(
    blocks.filter((block): block is Extract<Block, { type: "heading" }> => block.type === "heading").map((block) => slugify(block.text)),
  );

  return (
    <View testID={testID}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        switch (block.type) {
          case "meta":
            return (
              <View
                key={key}
                testID={`${testID ?? "markdown-lite"}-meta`}
                className="mb-5 gap-2 rounded-[10px] border border-border bg-bg-mute px-3.5 py-3"
              >
                {block.pairs.map(({ label, value }, pairIndex) => (
                  <View
                    key={`${key}-pair-${pairIndex}`}
                    className="flex-row items-baseline justify-between gap-3"
                  >
                    <Text className="font-sans-semibold text-caption uppercase text-fg-3">{label}</Text>
                    <Text className="flex-1 text-right font-sans text-[13px] text-fg-2" numberOfLines={2}>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case "heading": {
            const slug = slugify(block.text);
            return (
              <View
                key={key}
                onLayout={(event) => onHeadingLayout?.(slug, event.nativeEvent.layout.y)}
                className={block.level === 2 ? "mt-7 border-b border-border pb-2" : "mt-5"}
              >
                <Text
                  className={
                    block.level === 2
                      ? "font-sans-semibold text-h2 text-fg"
                      : "mb-2 font-sans-semibold text-h3 text-fg"
                  }
                >
                  {block.text}
                </Text>
              </View>
            );
          }
          case "paragraph":
            return (
              <Text key={key} className="mb-3 mt-3 font-sans text-body text-fg-2">
                {renderInline(block.text, key, onLinkPress)}
              </Text>
            );
          case "list":
            return (
              <View key={key} className="mb-3 mt-1 gap-2">
                {block.items.map((item, itemIndex) => {
                  const slug = slugify(item);
                  const isIndexLink = headingSlugs.has(slug);
                  return (
                    <View key={`${key}-item-${itemIndex}`} className="flex-row gap-2 pl-1">
                      <Text className="font-sans text-body text-fg-3">{"•"}</Text>
                      {isIndexLink ? (
                        <Text
                          suppressHighlighting
                          onPress={() => onLinkPress?.(`#${slug}`)}
                          className="flex-1 font-sans-medium text-body text-fg underline"
                        >
                          {item}
                        </Text>
                      ) : (
                        <Text className="flex-1 font-sans text-body text-fg-2">
                          {renderInline(item, `${key}-item-${itemIndex}`, onLinkPress)}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          case "quote":
            return (
              <View
                key={key}
                testID={`${testID ?? "markdown-lite"}-notice`}
                className="mb-4 gap-1.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3.5"
              >
                {block.lines.map((line, lineIndex) => {
                  const headingInQuote = /^#{1,3}\s+(.*)$/.exec(line);
                  if (headingInQuote) {
                    return (
                      <Text
                        key={`${key}-line-${lineIndex}`}
                        className="font-sans-semibold text-[14px] text-ink-950"
                      >
                        {headingInQuote[1]}
                      </Text>
                    );
                  }
                  if (line.trim() === "") return null;
                  return (
                    <Text key={`${key}-line-${lineIndex}`} className="font-sans text-[13px] text-ink-950">
                      {renderInline(line, `${key}-line-${lineIndex}`, onLinkPress)}
                    </Text>
                  );
                })}
              </View>
            );
          case "table":
            return (
              <View key={key} className="mb-4 mt-1 gap-2.5">
                {block.rows.map((row, rowIndex) => (
                  <View
                    key={`${key}-row-${rowIndex}`}
                    className="gap-1.5 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3"
                  >
                    {row.map((cell, cellIndex) => (
                      <View key={`${key}-row-${rowIndex}-cell-${cellIndex}`}>
                        <Text className="font-sans-semibold text-caption uppercase text-fg-3">
                          {block.header[cellIndex]}
                        </Text>
                        <Text className="mt-0.5 font-sans text-[13px] text-fg-2">
                          {renderInline(cell, `${key}-row-${rowIndex}-cell-${cellIndex}`, onLinkPress)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            );
          case "rule":
            return <View key={key} className="my-5 h-px bg-border" />;
          default:
            return null;
        }
      })}
    </View>
  );
}
