import { fireEvent, render } from "@testing-library/react-native";
import { LegalEntrySheet } from "../components/legal/legal-entry-sheet";

const COPY = { title: "Antes de empezar", body: "Todavía no aceptaste los Términos y Condiciones. Los necesitás para usar Movo." };

/** MOVO-229 (rediseño Claude Design): reemplaza el `Alert.alert` genérico por un
 * sheet propio, no bloqueante. */
describe("LegalEntrySheet", () => {
  it("muestra el título y el cuerpo recibidos por props", async () => {
    const { getByText } = await render(
      <LegalEntrySheet visible copy={COPY} onReview={jest.fn()} onDismiss={jest.fn()} />,
    );

    expect(getByText(COPY.title)).toBeTruthy();
    expect(getByText(COPY.body)).toBeTruthy();
  });

  it("'Revisar y aceptar' llama a onReview", async () => {
    const onReview = jest.fn();
    const { getByTestId } = await render(
      <LegalEntrySheet visible copy={COPY} onReview={onReview} onDismiss={jest.fn()} />,
    );

    fireEvent.press(getByTestId("legal-entry-sheet-review"));

    expect(onReview).toHaveBeenCalled();
  });

  it("no muestra el botón 'Ahora no' (comportamiento bloqueante)", async () => {
    const { queryByTestId } = await render(
      <LegalEntrySheet visible copy={COPY} onReview={jest.fn()} onDismiss={jest.fn()} />,
    );

    expect(queryByTestId("legal-entry-sheet-dismiss")).toBeNull();
  });

  it("tocar el fondo no llama a onDismiss ni cierra el sheet", async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(
      <LegalEntrySheet visible copy={COPY} onReview={jest.fn()} onDismiss={onDismiss} />,
    );

    fireEvent.press(getByTestId("legal-entry-sheet-backdrop"));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
