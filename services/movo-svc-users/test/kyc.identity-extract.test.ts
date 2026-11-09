import { describe, it, expect } from "vitest";
import { normalizePersonName } from "@movo/shared";
import { extractVerifiedIdentity } from "../src/modules/kyc/kyc.service";

/**
 * Forma de `decision.id_verifications[0]` tomada de decisiones reales de la app sandbox de Didit
 * (workflow KYC, 09/11/2026), recortada a los campos que lee `extractVerifiedIdentity`. Lo que se
 * verificó contra Didit: nombre y apellido llegan separados (`first_name` con todos los nombres de
 * pila, `last_name` con los apellidos), la fecha como `YYYY-MM-DD`, y una aprobación simulada sin
 * pasar por el flujo trae `id_verifications: null`.
 */
describe("extractVerifiedIdentity (forma real de la decisión de Didit)", () => {
  it("lee nombre, apellido y fecha de un pasaporte; el número alfanumérico no es un DNI", () => {
    const decision = {
      id_verifications: [
        {
          status: "Approved",
          document_type: "Passport",
          document_number: "AAF794880",
          personal_number: "99999999",
          first_name: "Maria Victoria",
          last_name: "Villareal",
          full_name: "Maria Victoria Villareal",
          date_of_birth: "1991-08-07",
        },
      ],
    };

    expect(extractVerifiedIdentity(decision)).toEqual({
      firstName: "Maria Victoria",
      lastName: "Villareal",
      dni: null,
      birthdate: new Date("1991-08-07T00:00:00.000Z"),
    });
  });

  it("un DNI con el número escrito con puntos queda en dígitos", () => {
    const identity = extractVerifiedIdentity({
      id_verifications: [
        { first_name: "JULIA MARÍA", last_name: "PÉREZ GÓMEZ", document_number: "12.345.678", date_of_birth: "1990-05-17" },
      ],
    });

    expect(identity).toMatchObject({ dni: "12345678", firstName: "JULIA MARÍA", lastName: "PÉREZ GÓMEZ" });
  });

  it("el nombre que se guarda sale en Nombre Apellido, con los acentos que traiga el documento", () => {
    const identity = extractVerifiedIdentity({
      id_verifications: [{ first_name: "JULIA MARÍA", last_name: "PÉREZ DE LA CRUZ" }],
    });

    expect(normalizePersonName(identity?.firstName)).toBe("Julia María");
    expect(normalizePersonName(identity?.lastName)).toBe("Pérez de la Cruz");
  });

  it("una aprobación simulada, sin documento leído (id_verifications null), no trae identidad", () => {
    expect(extractVerifiedIdentity({ id_verifications: null, status: "Approved" })).toBeNull();
  });

  it.each([
    ["sin decisión", undefined],
    ["lista vacía", { id_verifications: [] }],
    ["sin apellido", { id_verifications: [{ first_name: "Ana" }] }],
    ["sin nombre", { id_verifications: [{ last_name: "López" }] }],
    ["nombre en blanco", { id_verifications: [{ first_name: "  ", last_name: "López" }] }],
  ])("%s: no hay identidad que guardar", (_caso, decision) => {
    expect(extractVerifiedIdentity(decision)).toBeNull();
  });

  it("una fecha inválida no frena la identidad: queda sin fecha", () => {
    const identity = extractVerifiedIdentity({
      id_verifications: [{ first_name: "Ana", last_name: "López", date_of_birth: "no-es-fecha" }],
    });

    expect(identity).toMatchObject({ firstName: "Ana", lastName: "López", birthdate: null });
  });
});
