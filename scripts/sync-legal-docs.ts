/**
 * Sincroniza los documentos legales fuente (`docs/legal/*.md`) hacia las dos
 * copias que hoy se mantenían a mano (MOVO-224/228, ver `movo-mobile/CLAUDE.md`
 * y `shared/movo-shared/CLAUDE.md`):
 *
 *   1. `movo-mobile/src/content/legal/*.ts` — el `.md` empaquetado como
 *      template literal (Metro no soporta importar `.md` como texto sin un
 *      transformer custom).
 *   2. `shared/movo-shared/src/config/legal.ts` — `LEGAL_DOCUMENT_VERSIONS`,
 *      tomado de la línea "Última actualización" del propio `.md`.
 *
 * La fecha de versión NUNCA se deriva de un hash/diff del contenido — se
 * respeta la que quien edita el `.md` haya puesto a mano en "Última
 * actualización" (bumpearla ahí es la señal de que corresponde pedirle a la
 * app que vuelva a mostrar el documento para re-aceptación, MOVO-229).
 *
 * Uso:
 *   npx tsx scripts/sync-legal-docs.ts          # regenera los archivos derivados
 *   npx tsx scripts/sync-legal-docs.ts --check  # falla (sin escribir) si están desincronizados
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

type DocSpec = {
  kind: "terms" | "privacy";
  sourceMd: string;
  targetTs: string;
  exportName: string;
  headerComment: string;
};

const DOCS: DocSpec[] = [
  {
    kind: "terms",
    sourceMd: "docs/legal/terminos-y-condiciones.md",
    targetTs: "movo-mobile/src/content/legal/terminos-y-condiciones.ts",
    exportName: "TERMS_MARKDOWN",
    headerComment: `/**
 * Copia exacta del contenido de docs/legal/terminos-y-condiciones.md (MOVO-224),
 * para renderizar los Términos y Condiciones dentro de la app (Perfil -> Legal).
 *
 * Generado por \`scripts/sync-legal-docs.ts\` a partir del .md fuente — no editar
 * a mano. Corré \`npm run sync:legal\` después de tocar el .md.
 */`,
  },
  {
    kind: "privacy",
    sourceMd: "docs/legal/politica-privacidad.md",
    targetTs: "movo-mobile/src/content/legal/politica-privacidad.ts",
    exportName: "PRIVACY_POLICY_MARKDOWN",
    headerComment: `/**
 * Copia exacta del contenido de docs/legal/politica-privacidad.md (MOVO-224),
 * para renderizar la Política de Privacidad dentro de la app (Perfil -> Legal).
 *
 * Generado por \`scripts/sync-legal-docs.ts\` a partir del .md fuente — no editar
 * a mano. Corré \`npm run sync:legal\` después de tocar el .md.
 */`,
  },
];

const LEGAL_CONFIG_PATH = "shared/movo-shared/src/config/legal.ts";

function extractLastUpdatedDate(markdown: string, sourcePath: string): string {
  const match = markdown.match(/^\*\*Última actualización\*\*:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  if (!match) {
    throw new Error(
      `No se encontró la línea "**Última actualización**: YYYY-MM-DD" en ${sourcePath}`,
    );
  }
  return match[1];
}

function toTemplateLiteral(markdown: string): string {
  return markdown.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function buildGeneratedTs(doc: DocSpec, markdown: string): string {
  const escaped = toTemplateLiteral(markdown.trimEnd());
  return `${doc.headerComment}\nexport const ${doc.exportName} = \`${escaped}\n\`;\n`;
}

function buildLegalConfig(currentSource: string, versions: Record<"terms" | "privacy", string>): string {
  return currentSource.replace(
    /export const LEGAL_DOCUMENT_VERSIONS = \{[\s\S]*?\} as const;/,
    `export const LEGAL_DOCUMENT_VERSIONS = {\n  terms: "${versions.terms}",\n  privacy: "${versions.privacy}",\n} as const;`,
  );
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const versions: Partial<Record<"terms" | "privacy", string>> = {};
  const writes: Array<{ path: string; content: string }> = [];

  for (const doc of DOCS) {
    const sourcePath = join(ROOT, doc.sourceMd);
    const markdown = readFileSync(sourcePath, "utf8");
    versions[doc.kind] = extractLastUpdatedDate(markdown, doc.sourceMd);

    const targetPath = join(ROOT, doc.targetTs);
    const generated = buildGeneratedTs(doc, markdown);
    writes.push({ path: targetPath, content: generated });
  }

  const legalConfigPath = join(ROOT, LEGAL_CONFIG_PATH);
  const currentConfig = readFileSync(legalConfigPath, "utf8");
  const newConfig = buildLegalConfig(currentConfig, versions as Record<"terms" | "privacy", string>);
  writes.push({ path: legalConfigPath, content: newConfig });

  let outOfSync = false;
  for (const { path, content } of writes) {
    const existing = readFileSync(path, "utf8").toString();
    if (existing !== content) {
      outOfSync = true;
      console.log(`[sync-legal-docs] desincronizado: ${path}`);
      if (!checkOnly) {
        writeFileSync(path, content, "utf8");
        console.log(`[sync-legal-docs] regenerado: ${path}`);
      }
    }
  }

  if (!outOfSync) {
    console.log("[sync-legal-docs] todo sincronizado, nada que hacer.");
    return;
  }

  if (checkOnly) {
    console.error(
      "\n[sync-legal-docs] docs/legal/*.md cambió sin propagar. Corré `npm run sync:legal` y commiteá el resultado.",
    );
    process.exit(1);
  }
}

main();
