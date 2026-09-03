import { fireEvent, render } from "@testing-library/react-native";
import { StarRatingInput } from "../components/ui/star-rating-input";

describe("StarRatingInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renderiza las 5 estrellas", async () => {
    const { getByTestId } = await render(<StarRatingInput score={3} testID="custom-stars" />);
    expect(getByTestId("custom-stars-star-1")).toBeTruthy();
    expect(getByTestId("custom-stars-star-2")).toBeTruthy();
    expect(getByTestId("custom-stars-star-3")).toBeTruthy();
    expect(getByTestId("custom-stars-star-4")).toBeTruthy();
    expect(getByTestId("custom-stars-star-5")).toBeTruthy();
  });

  it("permite seleccionar una puntuación en modo interactivo", async () => {
    const handleChange = jest.fn();
    const { getByTestId } = await render(
      <StarRatingInput score={0} onChange={handleChange} testID="stars" />
    );

    await fireEvent.press(getByTestId("stars-star-4"));
    expect(handleChange).toHaveBeenCalledWith(4);

    await fireEvent.press(getByTestId("stars-star-5"));
    expect(handleChange).toHaveBeenCalledWith(5);
  });

  it("no dispara onChange en modo de solo lectura (readOnly)", async () => {
    const handleChange = jest.fn();
    const { getByTestId } = await render(
      <StarRatingInput score={4} readOnly onChange={handleChange} testID="stars" />
    );

    await fireEvent.press(getByTestId("stars-star-2"));
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("asigna roles y labels de accesibilidad correctos", async () => {
    const { getByLabelText, getByTestId } = await render(
      <StarRatingInput score={3} testID="accessible-stars" />
    );

    expect(getByTestId("accessible-stars")).toBeTruthy();
    expect(getByLabelText("3 estrellas")).toBeTruthy();
    expect(getByLabelText("1 estrella")).toBeTruthy();
  });
});
