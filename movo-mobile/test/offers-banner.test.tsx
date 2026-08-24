import { render } from "@testing-library/react-native";
import { OffersBanner } from "../components/shipments/offers-banner";

// MOVO-17 (ofertas) sin arrancar todavía — el banner siempre muestra el estado vacío.
describe("OffersBanner", () => {
  it("muestra el estado vacío", async () => {
    const { getByText } = await render(<OffersBanner testID="offers" />);

    expect(getByText("Ofertas")).toBeTruthy();
    expect(getByText("Aún no tenés ofertas")).toBeTruthy();
  });
});
