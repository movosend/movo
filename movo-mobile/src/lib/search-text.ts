/** Texto sin tildes y en minúsculas, para comparar búsquedas sin importar acentos ni mayúsculas. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
