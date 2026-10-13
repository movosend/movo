/**
 * MOVO-26: filtro de lenguaje ofensivo del chat. Tapa con asteriscos las palabras de la lista
 * (mismo largo, así el mensaje conserva su forma) y el servicio avisa a quien escribió que hay que
 * respetar a los demás miembros de la comunidad. No bloquea el envío: el mensaje sale, enmascarado.
 *
 * Es una lista de insultos y agravios fuertes en español rioplatense, a propósito acotada: las
 * palabrotas de uso cotidiano ("boludo", "mierda", "carajo") no se tapan, ni palabras que en este
 * dominio son legítimas ("retrasado" por un envío demorado). El equipo la puede ajustar
 * acá sin tocar nada más. Se compara por palabra entera (nunca por fragmento: "computadora" o "pijama"
 * no se tocan) y contra variantes comunes de evasión: mayúsculas, tildes, letras repetidas
 * ("puuuta") y números o símbolos por letras ("put4", "pu7a", "p$ta").
 */
export const CHAT_BLOCKED_TERMS: readonly string[] = [
  "puta",
  "puto",
  "putas",
  "putos",
  "hijo de puta",
  "hijos de puta",
  "hijoputa",
  "la puta madre",
  "puta madre",
  "hdp",
  "lpm",
  "ctm",
  "pelotudo",
  "pelotuda",
  "pelotudos",
  "forro",
  "forra",
  "forros",
  "concha",
  "conchudo",
  "conchuda",
  "reconcha",
  "la concha de tu madre",
  "la concha de la lora",
  "culiado",
  "culiada",
  "verga",
  "pija",
  "pijudo",
  "chupapija",
  "pajero",
  "pajera",
  "sorete",
  "mogolico",
  "mogolica",
  "imbecil",
  "idiota",
  "estupido",
  "estupida",
  "trolo",
  "trola",
  "maricon",
  "negro de mierda",
  "hijo de mil putas",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/** Minúsculas, sin tildes, números/símbolos comunes por su letra y sin letras repetidas seguidas. */
function normalizeToken(token: string): string {
  const base = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  return base.replace(/(.)\1+/g, "$1");
}

const BLOCKED = new Set(CHAT_BLOCKED_TERMS.map((term) => term.split(" ").map(normalizeToken).join(" ")));
const MAX_TERM_WORDS = Math.max(...CHAT_BLOCKED_TERMS.map((term) => term.split(" ").length));

/** Palabras: letras, números y los símbolos que se usan como letra ("put@", "p$ta", "p!ta"); un "!" al final es puntuación. */
const TOKEN = /[\p{L}\p{N}@$]+(?:!+[\p{L}\p{N}@$]+)*/gu;

export interface ModerationResult {
  text: string;
  /** Si se tapó alguna palabra. */
  masked: boolean;
}

function maskSegment(segment: string): string {
  return segment.replace(/[\p{L}\p{N}@$!]/gu, "*");
}

export function moderateChatText(input: string): ModerationResult {
  const tokens = [...input.matchAll(TOKEN)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    normalized: normalizeToken(m[0]),
  }));

  let result = "";
  let cursor = 0;
  let masked = false;
  let i = 0;
  while (i < tokens.length) {
    // La frase más larga primero: "hijo de puta" antes que "puta" suelta.
    let matchedWords = 0;
    for (let n = Math.min(MAX_TERM_WORDS, tokens.length - i); n >= 1; n--) {
      const candidate = tokens
        .slice(i, i + n)
        .map((t) => t.normalized)
        .join(" ");
      if (BLOCKED.has(candidate)) {
        matchedWords = n;
        break;
      }
    }
    if (matchedWords === 0) {
      i += 1;
      continue;
    }
    const start = tokens[i].start;
    const end = tokens[i + matchedWords - 1].end;
    result += input.slice(cursor, start) + maskSegment(input.slice(start, end));
    cursor = end;
    masked = true;
    i += matchedWords;
  }
  return { text: result + input.slice(cursor), masked };
}
