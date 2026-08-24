import { act, fireEvent, render } from "@testing-library/react-native";
import { EditAddressSheet } from "../components/addresses/edit-address-sheet";

jest.mock("../src/hooks/use-addresses", () => ({
  useUpdateAddress: jest.fn(),
}));

import { useUpdateAddress } from "../src/hooks/use-addresses";

const mockUseUpdateAddress = useUpdateAddress as jest.Mock;

const ADDRESS = {
  id: "addr-1",
  label: "Casa",
  isDefault: false,
  street: "Av. Colón",
  streetNumber: "1000",
  floorApartment: null,
  city: "Córdoba",
  province: "Córdoba",
  postalCode: "5000",
  country: "Argentina",
  lat: -31.4,
  long: -64.18,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// MOVO-121 AC4 (alcance acordado: solo label/isDefault, sin reabrir el buscador).
describe("EditAddressSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("precarga el label actual y manda isDefault:true solo cuando se activa el toggle", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseUpdateAddress.mockReturnValue({ mutateAsync, isPending: false });
    const onClose = jest.fn();

    const { getByTestId } = await render(
      <EditAddressSheet visible address={ADDRESS} onClose={onClose} testID="edit-sheet" />,
    );

    expect(getByTestId("edit-sheet-label").props.value).toBe("Casa");

    await act(async () => {
      fireEvent.press(getByTestId("edit-sheet-toggle-default"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("edit-sheet-save"));
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "addr-1",
      body: { label: "Casa", isDefault: true },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("no permite desmarcar (ni manda isDefault) una dirección que ya es default", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseUpdateAddress.mockReturnValue({ mutateAsync, isPending: false });

    const { getByTestId } = await render(
      <EditAddressSheet
        visible
        address={{ ...ADDRESS, isDefault: true }}
        onClose={jest.fn()}
        testID="edit-sheet"
      />,
    );

    expect(
      getByTestId("edit-sheet-toggle-default").props.accessibilityState?.disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.press(getByTestId("edit-sheet-save"));
      await Promise.resolve();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "addr-1",
      body: { label: "Casa" },
    });
  });

  it("muestra un banner de error si falla el guardado", async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new Error("network"));
    mockUseUpdateAddress.mockReturnValue({ mutateAsync, isPending: false });

    const { getByTestId } = await render(
      <EditAddressSheet visible address={ADDRESS} onClose={jest.fn()} testID="edit-sheet" />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("edit-sheet-save"));
      await Promise.resolve();
    });

    expect(getByTestId("edit-sheet-error")).toBeTruthy();
  });
});
