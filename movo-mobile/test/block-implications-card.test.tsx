import { render } from "@testing-library/react-native";
import { BlockImplicationsCard } from "../components/profile/block-implications-card";

/** MOVO-175 (ADR-026): cada fila refleja una regla que el backend aplica de verdad. */
describe("BlockImplicationsCard", () => {
  it("lista las cinco implicancias del bloqueo", async () => {
    const { getByText } = await render(<BlockImplicationsCard />);

    expect(getByText("Qué implica bloquear a alguien")).toBeTruthy();
    expect(getByText("No se ven en los listados")).toBeTruthy();
    expect(getByText("No hay nuevas interacciones")).toBeTruthy();
    expect(getByText("Lo que está en curso sigue")).toBeTruthy();
    expect(getByText("Los perfiles siguen visibles")).toBeTruthy();
    expect(getByText("Es reversible")).toBeTruthy();
  });
});
