/**
 * Monto en pesos como lo escribe una persona en es-AR: `1.240,50`, `1240,5`, `1240.50`, `$ 300`.
 * Devuelve un número positivo con hasta dos decimales, o `null` si no se entiende.
 */
export function parseAmountArs(raw: string): number | null {
  const text = raw.replace(/[\s$]/g, "")
  if (!/^\d[\d.,]*$/.test(text)) return null
  let normalized: string
  const comma = text.lastIndexOf(",")
  const dot = text.lastIndexOf(".")
  if (comma >= 0 && dot >= 0) {
    // El último separador es el decimal; el otro agrupa miles.
    const [decimal, group] = comma > dot ? [",", "."] : [".", ","]
    normalized = text.split(group).join("").replace(decimal, ".")
  } else if (comma >= 0) {
    normalized = text.replace(/\./g, "").replace(",", ".")
  } else if (dot >= 0) {
    // `1.240` agrupa miles; `1240.5` y `12.50` son decimales.
    normalized = /^\d{1,3}(\.\d{3})+$/.test(text)
      ? text.replace(/\./g, "")
      : text
  } else {
    normalized = text
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const value = Number(normalized)
  return value > 0 && Number.isFinite(value) ? value : null
}

/** Saldo con la misma lectura que la cuenta corriente: positivo es deuda. */
export function describeBalance(
  balanceArs: number,
  format: (amount: number) => string
): string {
  if (balanceArs > 0) return `Debe ${format(balanceArs)}`
  if (balanceArs < 0) return `A favor ${format(balanceArs)}`
  return "Al día"
}
