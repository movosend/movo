import { render } from "@testing-library/react-native";
import AuthenticatedLayout from "../app/(app)/_layout";

const mockUseAuthStore = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => mockUseAuthStore(selector),
}));

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="app-guard-redirect">{href}</Text>,
    Stack: () => <Text testID="app-guard-stack">stack</Text>,
  };
});

describe("app/(app)/_layout — guard de navegación (AC9)", () => {
  afterEach(() => jest.clearAllMocks());

  it("redirige a /login si no hay sesión autenticada, sin montar el Stack protegido", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));

    const { getByTestId, queryByTestId } = await render(<AuthenticatedLayout />);

    expect(getByTestId("app-guard-redirect")).toHaveTextContent("/login");
    expect(queryByTestId("app-guard-stack")).toBeNull();
  });

  it("renderiza el Stack protegido cuando hay sesión autenticada", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));

    const { getByTestId, queryByTestId } = await render(<AuthenticatedLayout />);

    expect(getByTestId("app-guard-stack")).toBeTruthy();
    expect(queryByTestId("app-guard-redirect")).toBeNull();
  });

  it("no monta el Stack protegido mientras la sesión sigue en 'checking' (defensivo)", async () => {
    mockUseAuthStore.mockImplementation((selector) => selector({ status: "checking" }));

    const { queryByTestId } = await render(<AuthenticatedLayout />);

    expect(queryByTestId("app-guard-stack")).toBeNull();
  });
});
