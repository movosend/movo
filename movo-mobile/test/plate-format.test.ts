import {
  detectFormat,
  formatLabel,
  isPlateValid,
  maskPlateInput,
  plateFormatErrorMessage,
  plateGroups,
  plateLength,
} from "../src/lib/plate-format";

describe("plate-format (MOVO-223)", () => {
  it("plateLength/plateGroups reflejan cada formato", () => {
    expect(plateLength("mercosur")).toBe(7);
    expect(plateLength("old")).toBe(6);
    expect(plateGroups("mercosur")).toEqual([2, 3, 2]);
    expect(plateGroups("old")).toEqual([3, 3]);
  });

  it("detectFormat detecta Mercosur por un número en la 3ra posición", () => {
    expect(detectFormat("AB1", "old")).toBe("mercosur");
    expect(detectFormat("ABC", "mercosur")).toBe("old");
    expect(detectFormat("AB", "mercosur")).toBe("mercosur"); // menos de 3 chars, sin cambio
  });

  it("maskPlateInput normaliza a mayúsculas y descarta caracteres inválidos", () => {
    expect(maskPlateInput("ab123cd", "mercosur")).toEqual({ value: "AB123CD", format: "mercosur" });
    expect(maskPlateInput("ab-123 cd!", "mercosur")).toEqual({ value: "AB123CD", format: "mercosur" });
  });

  it("maskPlateInput descarta un caracter que no matchea la posición esperada", () => {
    // Mercosur: posiciones 3-4-5 son numéricas — la "X" en la posición 4 se descarta,
    // el resto de los caracteres válidos en su posición se conserva.
    expect(maskPlateInput("AB1X3CD", "mercosur").value).toBe("AB13CD");
  });

  it("maskPlateInput trunca al largo del formato detectado", () => {
    expect(maskPlateInput("AB123CDXYZ", "mercosur").value).toBe("AB123CD");
    expect(maskPlateInput("ABC123XYZ", "old").value).toBe("ABC123");
  });

  it("cambiar de formato a mitad de tipeo re-detecta desde la 3ra posición", () => {
    // arranca como "old" (3 letras), pero la 3ra pos es un número → mercosur
    const result = maskPlateInput("AB1", "old");
    expect(result.format).toBe("mercosur");
    expect(result.value).toBe("AB1");
  });

  it("isPlateValid exige el patrón completo de cada formato", () => {
    expect(isPlateValid("AB123CD", "mercosur")).toBe(true);
    expect(isPlateValid("AB123C", "mercosur")).toBe(false);
    expect(isPlateValid("ABC123", "old")).toBe(true);
    expect(isPlateValid("AB123CD", "old")).toBe(false);
    expect(isPlateValid("", "mercosur")).toBe(false);
  });

  it("formatLabel/plateFormatErrorMessage difieren por formato", () => {
    expect(formatLabel("mercosur")).toBe("Mercosur");
    expect(formatLabel("old")).toBe("anterior");
    expect(plateFormatErrorMessage("mercosur")).toMatch(/Mercosur/);
    expect(plateFormatErrorMessage("old")).toMatch(/anterior/);
  });
});
