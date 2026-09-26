import { render } from "@testing-library/react-native";
import { MutualConnectionsRow } from "../components/profile/mutual-connections-row";

const mockUseMutualConnections = jest.fn();

jest.mock("../src/hooks/use-profile", () => ({
  useMutualConnections: (id: string) => mockUseMutualConnections(id),
}));

describe("MutualConnectionsRow", () => {
  afterEach(() => jest.clearAllMocks());

  it("no renderiza nada mientras no hay datos", async () => {
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
    expect(getByText(/Ya hizo envíos con 5 personas que vos también conocés/)).toBeTruthy();
  });

  it("nombra a la persona de muestra y cuenta el resto", async () => {
    mockUseMutualConnections.mockReturnValue({
      data: { totalCount: 5, sampleFirstNames: ["Malena"] },
    });
    const { getByText } = await render(<MutualConnectionsRow userId="user-2" />);
    expect(getByText(/Ya hizo envíos con Malena y 4 personas más que vos también conocés/)).toBeTruthy();
  });
  describe("medallón de anillos", () => {
    const renderWith = async (total: number) => {
      mockUseMutualConnections.mockReturnValue({ data: { totalCount: total, sampleFirstNames: [] } });
      return render(<MutualConnectionsRow userId="user-2" testID="mutual" />);
    };

    it("muestra el conteo en el núcleo y el copy en singular con 1 conexión", async () => {
      const { getByText } = await renderWith(1);

      expect(getByText("En común")).toBeTruthy();
      expect(getByText(/Ya hizo envíos con 1 persona que vos también conocés/)).toBeTruthy();
    });

    // Un render por caso: varios árboles en el mismo test con `unmount()` sin esperar dejan roto el
    // entorno de `act` para los tests siguientes del archivo.
    it.each([
      [1, 1],
      [2, 2],
      [3, 3],
      [9, 3],
    ])("con %i conexiones se dibujan %i anillos (uno por conexión, hasta 3)", async (total, rings) => {
      const { queryByTestId } = await renderWith(total);

      for (let i = 0; i < 3; i += 1) {
        const ring = queryByTestId(`mutual-ring-${i}`, { includeHiddenElements: true });
        if (i < rings) {
          expect(ring).toBeTruthy();
        } else {
          expect(ring).toBeNull();
        }
      }
    });

    it("el núcleo lleva el número en lima con texto ink", async () => {
      const { getByTestId } = await renderWith(5);

      expect(getByTestId("mutual-count", { includeHiddenElements: true })).toHaveTextContent("5");
      expect(getByTestId("mutual-core", { includeHiddenElements: true })).toHaveStyle({ backgroundColor: "#C6F24A" });
      expect(getByTestId("mutual-count", { includeHiddenElements: true })).toHaveStyle({ color: "#0A0A0B" });
    });

    it("muestra 99+ cuando el conteo no entra en el núcleo", async () => {
      const { getByTestId, getByText } = await renderWith(150);

      expect(getByTestId("mutual-count", { includeHiddenElements: true })).toHaveTextContent("99+");
      // El copy conserva el número real.
      expect(getByText(/Ya hizo envíos con 150 personas/)).toBeTruthy();
    });

    it("el medallón es decorativo: oculto a los lectores de pantalla, el copy lo dice en texto", async () => {
      const { queryByTestId, getByText } = await renderWith(3);

      expect(queryByTestId("mutual-core")).toBeNull(); // oculto por defecto
      expect(getByText(/Ya hizo envíos con 3 personas/)).toBeTruthy();
    });
  });
});
