import { describe, expect, it } from "vitest"
import {
  diditStatusPill,
  documentTypeLabel,
  formatScore,
  genderLabel,
  livenessMethodLabel,
  maritalStatusLabel,
  warningFeatureLabel,
  yesNo,
} from "./evidence-format"

describe("formatos del detalle de Didit", () => {
  it("traduce los estados de Didit y deja pasar los desconocidos", () => {
    expect(diditStatusPill("Approved")).toEqual({ label: "Aprobado", tone: "success" })
    expect(diditStatusPill("Declined")?.tone).toBe("danger")
    expect(diditStatusPill("In Review")?.tone).toBe("warning")
    expect(diditStatusPill("Algo Nuevo")).toEqual({ label: "Algo Nuevo", tone: "neutral" })
    expect(diditStatusPill(null)).toBeNull()
  })

  it("traduce documento, género, método de prueba de vida y origen de las alertas", () => {
    expect(documentTypeLabel("Driver's License")).toBe("Licencia de conducir")
    expect(documentTypeLabel("Otro")).toBe("Otro")
    expect(documentTypeLabel(null)).toBeNull()
    expect(genderLabel("m")).toBe("Masculino")
    expect(livenessMethodLabel("PASSIVE")).toBe("Pasiva")
    expect(maritalStatusLabel("Single")).toBe("Soltero/a")
    expect(maritalStatusLabel("Otro")).toBe("Otro")
    expect(warningFeatureLabel("FACE_MATCH")).toBe("Coincidencia facial")
    expect(warningFeatureLabel("NUEVO_FEATURE")).toBe("nuevo feature")
  })

  it("redondea la puntuación y resuelve sí/no", () => {
    expect(formatScore(97.4)).toBe("97 %")
    expect(formatScore(null)).toBeNull()
    expect(yesNo(true)).toBe("Sí")
    expect(yesNo(false)).toBe("No")
    expect(yesNo(null)).toBeNull()
  })
})
