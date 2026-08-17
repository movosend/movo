import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { ReceiverSearchField } from "../components/send/receiver-search-field";

jest.mock("../src/api/users-client", () => ({
  usersClient: {
    search: jest.fn(),
  },
}));

import { usersClient } from "../src/api/users-client";

const mockSearch = usersClient.search as jest.Mock;

// Invitación por WhatsApp cuando la búsqueda no encuentra a nadie: sin cobertura
// previa de este componente (ver comentario en address-field.test.tsx sobre por
// qué se agrega recién ahora).
describe("ReceiverSearchField", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  });

  it("muestra resultados y no ofrece invitar cuando encuentra gente", async () => {
    mockSearch.mockResolvedValue([
      { id: "u1", fullName: "Ana López", isVerified: true, photoUrl: null, reputationScore: null },
    ]);

    const { getByTestId, getByText, queryByTestId } = await render(
      <ReceiverSearchField
        testID="receiver"
        selected={null}
        onSelect={jest.fn()}
        onClear={jest.fn()}
        onFocusInput={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId("receiver"), "Ana");

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("Ana"), { timeout: 1000 });
    await waitFor(() => expect(getByText("Ana López")).toBeTruthy());
    expect(queryByTestId("receiver-invite")).toBeNull();
  });

  it("ofrece invitar por WhatsApp cuando no encuentra a nadie", async () => {
    mockSearch.mockResolvedValue([]);

    const { getByTestId, findByTestId } = await render(
      <ReceiverSearchField
        testID="receiver"
        selected={null}
        onSelect={jest.fn()}
        onClear={jest.fn()}
        onFocusInput={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId("receiver"), "Nadie Existente");

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("Nadie Existente"), { timeout: 1000 });
    const inviteButton = await findByTestId("receiver-invite-whatsapp");

    fireEvent.press(inviteButton);

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(url.split("text=")[1])).toContain("Movo");
  });

  it("no ofrece invitar mientras la búsqueda está en curso", async () => {
    let resolveSearch: (value: unknown[]) => void = () => {};
    mockSearch.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    const { getByTestId, queryByTestId } = await render(
      <ReceiverSearchField
        testID="receiver"
        selected={null}
        onSelect={jest.fn()}
        onClear={jest.fn()}
        onFocusInput={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId("receiver"), "Alguien");

    await waitFor(() => expect(mockSearch).toHaveBeenCalled(), { timeout: 1000 });
    expect(queryByTestId("receiver-invite")).toBeNull();

    resolveSearch([]);
    await waitFor(() => expect(getByTestId("receiver-invite")).toBeTruthy());
  });
});
