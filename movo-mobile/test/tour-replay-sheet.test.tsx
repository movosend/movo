import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { TourReplaySheet } from "../components/tour/tour-replay-sheet";
import { useTourStore } from "../src/store/tour-store";

let mockCanBrowse = false;
jest.mock("../src/hooks/use-transport-gate", () => ({
  useTransportGate: () => ({ canBrowse: mockCanBrowse }),
}));
jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => ({ data: { firstName: "pauli" } }),
}));

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Pressable testID="reopen" onPress={() => setOpen(true)}>
        <Text>abrir</Text>
      </Pressable>
      <TourReplaySheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("TourReplaySheet (MOVO-169, AC5)", () => {
  beforeEach(() => {
    mockCanBrowse = false;
    useTourStore.setState({ active: null, anchors: {}, pending: [], pendingLoaded: true });
  });

  it("sin requisitos completos solo ofrece 'Cómo enviar'", async () => {
    const { findByText, queryByText } = await render(<Harness />);

    expect(await findByText("¿Qué querés repasar?")).toBeTruthy();
    expect(await findByText("Cómo enviar")).toBeTruthy();
    expect(queryByText("Cómo transportar")).toBeNull();
  });

  it("con todo listo ofrece también 'Cómo transportar'", async () => {
    mockCanBrowse = true;
    const { findByText } = await render(<Harness />);

    expect(await findByText("Cómo transportar")).toBeTruthy();
    expect(await findByText("Viajes, ofertas y tu ruta del día")).toBeTruthy();
  });

  it("elegir un tour lo relanza a mano (sin registro) cuando la hoja terminó de cerrarse", async () => {
    mockCanBrowse = true;
    const { findByTestId } = await render(<Harness />);

    await fireEvent.press(await findByTestId("tour-replay-carrier"));

    await waitFor(() => expect(useTourStore.getState().active).toMatchObject({ tourId: "carrier", manual: true }));
    expect(useTourStore.getState().context).toMatchObject({ firstName: "Pauli", canBrowse: true });
  });
});
