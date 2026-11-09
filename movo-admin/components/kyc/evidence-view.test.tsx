import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { AdminKycEvidence } from "@movo/shared/src/types/admin-kyc"
import { EvidenceView, kpisOf } from "./evidence-view"

afterEach(cleanup)

const evidence = (over: Partial<AdminKycEvidence> = {}): AdminKycEvidence => ({
  fetchedAt: "2026-11-09T15:00:00.000Z",
  imagesExpireAt: "2026-11-09T16:00:00.000Z",
  sessionStatus: "In Review",
  images: {
    selfie: "https://didit.test/selfie.jpg?sig=1",
    documentPortrait: "https://didit.test/portrait.jpg?sig=1",
    documentFront: "https://didit.test/front.jpg?sig=1",
    documentBack: null,
    livenessVideo: null,
  },
  document: {
    status: "In Review",
    type: "Driver's License",
    number: "45346504",
    personalNumber: "20453465048",
    firstName: "Lucas",
    lastName: "Dalmagro",
    fullName: "Lucas Dalmagro",
    dateOfBirth: "2004-02-26",
    age: 22,
    gender: "M",
    nationality: "ARG",
    issuingCountry: "Argentina",
    issueDate: "2024-12-02",
    expirationDate: "2029-12-02",
    address: null,
    placeOfBirth: null,
    maritalStatus: null,
  },
  faceMatch: { status: "Approved", score: 97.4 },
  liveness: { status: "Approved", method: "PASSIVE", score: 100 },
  ip: {
    status: "Approved",
    address: "190.1.2.3",
    country: "Argentina",
    region: "Córdoba",
    city: "Córdoba",
    isVpnOrTor: true,
    isDataCenter: false,
    platform: "mobile",
    browser: "Chrome",
    os: "Android",
    device: "Samsung A54",
  },
  aml: { status: "Approved", totalHits: 0, score: 0 },
  phone: { status: "Approved", value: "+54 3511234567", country: "Argentina", isDisposable: false, isVirtual: false },
  email: { status: "Approved", value: "lucas@example.com", country: null, isDisposable: false, isVirtual: null },
  warnings: [{ feature: "FACE_MATCH", risk: "LOW_FACE_MATCH_SIMILARITY", description: "Baja similitud" }],
  reviews: [{ status: "In Review", comment: "Revisar foto", createdAt: "2026-11-08T10:00:00Z" }],
  ...over,
})

describe("EvidenceView", () => {
  it("el resumen muestra solo las caras: la selfie grande y la miniatura del documento la cambia", () => {
    render(<EvidenceView evidence={evidence()} />)

    const summary = screen.getByRole("heading", { name: "Resumen" }).closest("section")!
    const big = within(summary).getByAltText("Selfie")
    expect(big).toHaveAttribute("src", "https://didit.test/selfie.jpg?sig=1")
    expect(big).toHaveAttribute("referrerpolicy", "no-referrer")
    // los documentos enteros no van en el marco vertical del resumen (se recortarían): tienen su sección
    expect(within(summary).queryByRole("button", { name: /documento, frente/i })).not.toBeInTheDocument()

    fireEvent.click(within(summary).getByRole("button", { name: "Ver foto del documento" }))

    expect(within(summary).getByAltText("Foto del documento")).toHaveAttribute("src", "https://didit.test/portrait.jpg?sig=1")
    expect(within(summary).getByRole("button", { name: "Ver foto del documento" })).toHaveAttribute("aria-pressed", "true")
  })

  it("tocar la foto grande la abre ampliada", async () => {
    render(<EvidenceView evidence={evidence()} />)

    const summary = screen.getByRole("heading", { name: "Resumen" }).closest("section")!
    fireEvent.click(within(summary).getByRole("button", { name: "Ampliar selfie" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByAltText("Selfie")).toBeInTheDocument()
  })

  it("una foto que no carga avisa que el link pudo vencer, en vez de dejar un hueco roto", () => {
    render(<EvidenceView evidence={evidence()} />)

    const summary = screen.getByRole("heading", { name: "Resumen" }).closest("section")!
    fireEvent.error(within(summary).getByAltText("Selfie"))

    expect(within(summary).getByRole("img", { name: /Selfie: no se pudo cargar/ })).toBeInTheDocument()
  })

  it("cada comprobación tiene un valor corto, el detalle aparte y un ícono de estado con su texto", () => {
    render(<EvidenceView evidence={evidence()} />)

    const summary = screen.getByRole("heading", { name: "Resumen" }).closest("section")!
    expect(within(summary).getByText("97 %")).toBeInTheDocument()
    expect(within(summary).getByText("Selfie frente al documento")).toBeInTheDocument()
    expect(within(summary).getByText("Prueba pasiva")).toBeInTheDocument()
    expect(within(summary).getByText("Licencia de conducir · Argentina")).toBeInTheDocument()
    expect(within(summary).getByText(/Válido hasta/)).toBeInTheDocument()
    expect(within(summary).getByText("Sin coincidencias")).toBeInTheDocument()
    expect(within(summary).getByText("190.1.2.3")).toBeInTheDocument()
    expect(within(summary).getByText("Córdoba, Argentina · VPN o Tor")).toBeInTheDocument()
    expect(within(summary).getAllByText("Aprobado").length).toBeGreaterThan(3)
    expect(within(summary).getByText(/Estado en Didit/)).toBeInTheDocument()
    expect(within(summary).getByText(/no los guarda/)).toBeInTheDocument()
  })

  it("el perfil muestra lo que leyó Didit, las dos caras y omite lo que no informó", () => {
    render(<EvidenceView evidence={evidence()} />)

    const card = screen.getByRole("heading", { name: "Perfil" }).closest("section")!
    expect(within(card).getByText("45346504")).toBeInTheDocument()
    expect(within(card).getByText("20453465048")).toBeInTheDocument()
    expect(within(card).getByText("Masculino")).toBeInTheDocument()
    expect(within(card).getByText("26 feb 2004")).toBeInTheDocument()
    expect(within(card).getByText("22 años")).toBeInTheDocument()
    expect(within(card).getByAltText("Selfie")).toBeInTheDocument()
    expect(within(card).getByAltText("Foto del documento")).toBeInTheDocument()
    expect(within(card).getByText("97 %")).toBeInTheDocument()
    expect(within(card).queryByText("Domicilio")).not.toBeInTheDocument()
    expect(within(card).queryByText("Estado civil")).not.toBeInTheDocument()
  })

  it("documentos muestra solo los lados que vinieron, enteros", () => {
    render(<EvidenceView evidence={evidence()} />)

    const card = screen.getByRole("heading", { name: "Documentos" }).closest("section")!
    expect(within(card).getByAltText("Documento, frente")).toHaveClass("object-contain")
    expect(within(card).queryByAltText("Documento, dorso")).not.toBeInTheDocument()
  })

  it("red y dispositivo marca la VPN", () => {
    render(<EvidenceView evidence={evidence()} />)

    const card = screen.getByRole("heading", { name: "Red y dispositivo" }).closest("section")!
    expect(within(card).getAllByText("VPN o Tor").length).toBeGreaterThan(0)
    expect(within(card).getByText("Samsung A54")).toBeInTheDocument()
  })

  it("lista las alertas con su origen y las revisiones de Didit", () => {
    render(<EvidenceView evidence={evidence()} />)

    const card = screen.getByRole("heading", { name: "Alertas de Didit" }).closest("section")!
    expect(within(card).getByText("Baja similitud")).toBeInTheDocument()
    expect(within(card).getByText(/Coincidencia facial ·/)).toBeInTheDocument()
    expect(within(card).getByText("LOW_FACE_MATCH_SIMILARITY")).toBeInTheDocument()
    expect(within(card).getByText("Revisar foto")).toBeInTheDocument()
  })

  it("sin alertas ni revisiones lo dice", () => {
    render(<EvidenceView evidence={evidence({ warnings: [], reviews: [] })} />)

    expect(screen.getByText("Didit no marcó alertas en ninguna verificación.")).toBeInTheDocument()
    expect(screen.queryByText("Revisiones en Didit")).not.toBeInTheDocument()
  })

  it("una sesión sin datos muestra los estados vacíos y no inventa secciones", () => {
    render(
      <EvidenceView
        evidence={evidence({
          images: { selfie: null, documentPortrait: null, documentFront: null, documentBack: null, livenessVideo: null },
          document: null,
          faceMatch: null,
          liveness: null,
          ip: null,
          aml: null,
          phone: null,
          email: null,
          warnings: [],
          reviews: [],
        })}
      />
    )

    expect(screen.getByText("Didit no devolvió fotos del rostro.")).toBeInTheDocument()
    expect(screen.getByText("Didit no informó comprobaciones")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Perfil" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Documentos" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Red y dispositivo" })).not.toBeInTheDocument()
  })
})

describe("kpisOf", () => {
  it("arma las cuatro cifras con el tono del estado de Didit", () => {
    const kpis = kpisOf(evidence(), 3)

    expect(kpis.map((k) => [k.label, k.value, k.tone])).toEqual([
      ["Coincidencia facial", "97 %", "ok"],
      ["Prueba de vida", "100 %", "ok"],
      ["Alertas de Didit", "1", "warn"],
      ["Intentos", "3", undefined],
    ])
  })

  it("sin datos de Didit muestra guiones y cero alertas en verde", () => {
    const kpis = kpisOf(evidence({ faceMatch: null, liveness: null, warnings: [] }), 1)

    expect(kpis[0]).toMatchObject({ value: "—", sub: "sin dato" })
    expect(kpis[1]).toMatchObject({ value: "—" })
    expect(kpis[2]).toMatchObject({ value: "0", tone: "ok" })
    expect(kpis[3]).toMatchObject({ value: "1", sub: "el primero" })
  })
})
