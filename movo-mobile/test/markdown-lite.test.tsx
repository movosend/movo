import { fireEvent, render } from "@testing-library/react-native";
import {
  MarkdownLite,
  parseMarkdownLite,
} from "../components/legal/markdown-lite";

describe("parseMarkdownLite", () => {
  it("parsea el bloque de metadata del encabezado como un solo bloque 'meta'", () => {
    const blocks = parseMarkdownLite(
      "**Versión**: 0.1\n**Última actualización**: 2026-09-13\n\n## 1. Título\n",
    );

    expect(blocks[0]).toEqual({
      type: "meta",
      pairs: [
        { label: "Versión", value: "0.1" },
        { label: "Última actualización", value: "2026-09-13" },
      ],
    });
    expect(blocks[1]).toEqual({ type: "heading", level: 2, text: "1. Título" });
  });

  it("no confunde una intro en negrita dentro de un párrafo con metadata", () => {
    const blocks = parseMarkdownLite(
      "## 1. Título\n\n**Nota**: esto es un párrafo normal.\n",
    );

    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "1. Título" },
      { type: "paragraph", text: "**Nota**: esto es un párrafo normal." },
    ]);
  });

  it("parsea encabezados de nivel 2 y 3", () => {
    const blocks = parseMarkdownLite("## Título grande\n\n### Subtítulo\n");

    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "Título grande" },
      { type: "heading", level: 3, text: "Subtítulo" },
    ]);
  });

  it("ignora el título de portada (# nivel 1)", () => {
    const blocks = parseMarkdownLite("# Portada\n\nContenido.\n");

    expect(blocks).toEqual([{ type: "paragraph", text: "Contenido." }]);
  });

  it("junta líneas consecutivas de un párrafo en una sola", () => {
    const blocks = parseMarkdownLite("Primera línea\nsegunda línea.\n");

    expect(blocks).toEqual([
      { type: "paragraph", text: "Primera línea segunda línea." },
    ]);
  });

  it("parsea listas con guión y listas numeradas por igual", () => {
    const blocks = parseMarkdownLite(
      "- Uno\n- Dos\n\n1. Primero\n2. Segundo\n",
    );

    expect(blocks).toEqual([
      { type: "list", items: ["Uno", "Dos"] },
      { type: "list", items: ["Primero", "Segundo"] },
    ]);
  });

  it("parsea un blockquote de varias líneas, sacando el prefijo '>'", () => {
    const blocks = parseMarkdownLite("> ## Aviso\n>\n> Texto del aviso.\n");

    expect(blocks).toEqual([
      { type: "quote", lines: ["## Aviso", "", "Texto del aviso."] },
    ]);
  });

  it("parsea una tabla con encabezado y filas", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n";

    const blocks = parseMarkdownLite(source);

    expect(blocks).toEqual([
      {
        type: "table",
        header: ["A", "B"],
        rows: [
          ["1", "2"],
          ["3", "4"],
        ],
      },
    ]);
  });

  it("parsea '---' como una regla horizontal", () => {
    const blocks = parseMarkdownLite("Antes.\n\n---\n\nDespués.\n");

    expect(blocks).toEqual([
      { type: "paragraph", text: "Antes." },
      { type: "rule" },
      { type: "paragraph", text: "Después." },
    ]);
  });
});

describe("MarkdownLite", () => {
  it("renderiza negrita, código en línea y una tabla como tarjetas apiladas", async () => {
    const source =
      "Un párrafo con **negrita** y `código`.\n\n" +
      "| Columna | Valor |\n| --- | --- |\n| Fila 1 | Contenido 1 |\n";

    const { getByText } = await render(
      <MarkdownLite source={source} testID="doc" />,
    );

    expect(getByText("negrita")).toBeTruthy();
    expect(getByText("código")).toBeTruthy();
    expect(getByText("Columna")).toBeTruthy();
    expect(getByText("Contenido 1")).toBeTruthy();
  });

  it("renderiza en itálica una línea envuelta entera en *asteriscos*, sin tragarse un enlace anidado", async () => {
    const source =
      "*Ver también: [Política de Privacidad](./politica-privacidad.md).*";
    const onLinkPress = jest.fn();

    const { getByText } = await render(
      <MarkdownLite source={source} testID="doc" onLinkPress={onLinkPress} />,
    );

    fireEvent.press(getByText("Política de Privacidad"));

    expect(onLinkPress).toHaveBeenCalledWith("./politica-privacidad.md");
  });

  it("renderiza el bloque de metadata del encabezado como una tarjeta, no un párrafo pegoteado", async () => {
    const source = "**Versión**: 0.1\n**Vigencia**: no vigente\n\n## 1. Algo\n";

    const { getByTestId, getByText } = await render(
      <MarkdownLite source={source} testID="doc" />,
    );

    expect(getByTestId("doc-meta")).toBeTruthy();
    expect(getByText("Versión")).toBeTruthy();
    expect(getByText("0.1")).toBeTruthy();
  });

  it("renderiza el aviso académico (blockquote) con su propio testID", async () => {
    const source = "> ## Aviso\n>\n> Cuerpo del aviso.\n";

    const { getByTestId, getByText } = await render(
      <MarkdownLite source={source} testID="doc" />,
    );

    expect(getByTestId("doc-notice")).toBeTruthy();
    expect(getByText("Aviso")).toBeTruthy();
    expect(getByText("Cuerpo del aviso.")).toBeTruthy();
  });

  it("convierte el índice en enlaces tocables hacia sus encabezados", async () => {
    const source =
      "## 0. Índice\n\n1. Primera sección\n2. Segunda sección\n\n## 1. Primera sección\n\nTexto.\n\n## 2. Segunda sección\n\nOtro texto.\n";
    const onLinkPress = jest.fn();

    const { getByText } = await render(
      <MarkdownLite source={source} testID="doc" onLinkPress={onLinkPress} />,
    );

    fireEvent.press(getByText("Primera sección"));

    expect(onLinkPress).toHaveBeenCalledWith("#primera-seccion");
  });

  it("no convierte en enlace un ítem de lista que no coincide con ningún encabezado", async () => {
    const source =
      "## 1. Algo\n\n- Un ítem cualquiera sin encabezado asociado\n";
    const onLinkPress = jest.fn();

    const { getByText } = await render(
      <MarkdownLite source={source} testID="doc" onLinkPress={onLinkPress} />,
    );

    fireEvent.press(getByText("Un ítem cualquiera sin encabezado asociado"));

    expect(onLinkPress).not.toHaveBeenCalled();
  });

  it("reporta el offset de cada encabezado vía onHeadingLayout", async () => {
    const onHeadingLayout = jest.fn();
    const source = "## 1. Una sección\n\nTexto.\n";

    const { getByText } = await render(
      <MarkdownLite
        source={source}
        testID="doc"
        onHeadingLayout={onHeadingLayout}
      />,
    );
    fireEvent(getByText("1. Una sección").parent!, "layout", {
      nativeEvent: { layout: { y: 42, x: 0, width: 100, height: 20 } },
    });

    expect(onHeadingLayout).toHaveBeenCalledWith("una-seccion", 42);
  });

  it("llama a onLinkPress con el href de un enlace [texto](url)", async () => {
    const source =
      "Escribinos a [privacy@mail.movosend.app](mailto:privacy@mail.movosend.app).";
    const onLinkPress = jest.fn();

    const { getByText } = await render(
      <MarkdownLite source={source} testID="doc" onLinkPress={onLinkPress} />,
    );

    fireEvent.press(getByText("privacy@mail.movosend.app"));

    expect(onLinkPress).toHaveBeenCalledWith(
      "mailto:privacy@mail.movosend.app",
    );
  });
});
