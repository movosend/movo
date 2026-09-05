import { render } from "@testing-library/react-native";
import { MutualConnectionsRow } from "../components/profile/mutual-connections-row";

const mockUseMutualConnections = jest.fn();

jest.mock("../src/hooks/use-profile", () => ({
  useMutualConnections: (id: string) => mockUseMutualConnections(id),
}));

describe("MutualConnectionsRow", () => {
  afterEach(() => jest.clearAllMocks());

  it("no renderiza nada mientras no hay datos (MOVO-174, todavía sin backend)", async () => {
    mockUseMutualConnections.mockReturnValue({ data: undefined });
    const { toJSON } = await render(<MutualConnectionsRow userId="user-2" />);
    expect(toJSON()).toBeNull();
  });

  it("no renderiza nada si el conteo es 0", async () => {
    mockUseMutualConnections.mockReturnValue({
      data: { totalCount: 0, sampleFirstNames: [] },
    });
    const { toJSON } = await render(<MutualConnectionsRow userId="user-2" />);
    expect(toJSON()).toBeNull();
  });

  it("muestra solo el conteo cuando no hay nombres de muestra (opción conservadora de privacidad)", async () => {
    mockUseMutualConnections.mockReturnValue({
      data: { totalCount: 5, sampleFirstNames: [] },
    });
    const { getByText } = await render(<MutualConnectionsRow userId="user-2" />);
    expect(getByText(/Ya envió con 5 personas/)).toBeTruthy();
  });

  it("nombra a la persona de muestra y cuenta el resto", async () => {
    mockUseMutualConnections.mockReturnValue({
      data: { totalCount: 5, sampleFirstNames: ["Malena"] },
    });
    const { getByText } = await render(<MutualConnectionsRow userId="user-2" />);
    expect(getByText(/Ya envió con Malena y 4 personas más/)).toBeTruthy();
  });
});
