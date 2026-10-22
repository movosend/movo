import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccountSuspendedBanner } from "../components/account/account-suspended-banner";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

// MOVO-300 AC1: aviso permanente de cuenta suspendida en el inicio.
describe("AccountSuspendedBanner", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra el plazo de una suspensión con fecha de fin, en horario argentino", async () => {
    // 02:00 UTC del 26/10 son las 23:00 del 25/10 en Argentina.
    const { getByTestId } = await render(
      <AccountSuspendedBanner
        testID="banner"
        suspension={{
          type: "suspension",
          reason: "Conducta inapropiada",
          endsAt: "2026-10-26T02:00:00.000Z",
        }}
      />,
    );

    expect(getByTestId("banner-title")).toHaveTextContent(
      "Tu cuenta está suspendida hasta el 25/10",
    );
  });

  it("muestra 'por tiempo indefinido' sin fecha de fin", async () => {
    const { getByTestId } = await render(
      <AccountSuspendedBanner
        testID="banner"
        suspension={{ type: "suspension", reason: "Fraude", endsAt: null }}
      />,
    );

    expect(getByTestId("banner-title")).toHaveTextContent(
      "Tu cuenta está suspendida por tiempo indefinido",
    );
  });

  it("no muestra el motivo: el detalle está en la pantalla de estado, que abre al tocarlo", async () => {
    const { getByTestId, queryByText } = await render(
      <AccountSuspendedBanner
        testID="banner"
        suspension={{ type: "suspension", reason: "Fraude", endsAt: null }}
      />,
    );

    expect(queryByText(/Fraude/)).toBeNull();
    fireEvent.press(getByTestId("banner"));
    expect(router.push).toHaveBeenCalledWith("/account-status");
  });

  it("no renderiza nada sin una suspensión vigente", async () => {
    const { queryByTestId } = await render(
      <AccountSuspendedBanner testID="banner" suspension={null} />,
    );

    expect(queryByTestId("banner")).toBeNull();
  });
});
