import { render } from "@testing-library/react-native";
import { CounterpartCard } from "../components/shipments/counterpart-card";

const mockUsePublicProfile = jest.fn();

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => mockUsePublicProfile(),
}));

describe("CounterpartCard", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra un indicador de carga mientras el fetch está pendiente", async () => {
    mockUsePublicProfile.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { getByTestId } = await render(<CounterpartCard userId="user-2" testID="counterpart" />);

    expect(getByTestId("counterpart")).toBeTruthy();
  });

  it("muestra el estado de error si el perfil no pudo cargarse", async () => {
    mockUsePublicProfile.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    const { getByText } = await render(<CounterpartCard userId="user-2" />);

    expect(getByText("No pudimos cargar este perfil.")).toBeTruthy();
  });

  it("muestra el nombre y la insignia de verificado cuando el perfil está verificado", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "user-2",
        fullName: "Marta González",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
      },
      isLoading: false,
      isError: false,
    });

    const { getByText } = await render(<CounterpartCard userId="user-2" />);

    expect(getByText("Marta González")).toBeTruthy();
    expect(getByText("Identidad verificada")).toBeTruthy();
  });

  it("no muestra la insignia de verificado cuando el perfil no está verificado", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "user-3",
        fullName: "Juan Pérez",
        photoUrl: null,
        isVerified: false,
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
      },
      isLoading: false,
      isError: false,
    });

    const { getByText, queryByText } = await render(<CounterpartCard userId="user-3" />);

    expect(getByText("Juan Pérez")).toBeTruthy();
    expect(queryByText("Identidad verificada")).toBeNull();
  });

  it("muestra el badge de confirmación del receptor cuando se pasa `receiverConfirmation`", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "user-2",
        fullName: "Marta González",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
      },
      isLoading: false,
      isError: false,
    });

    const { getByText } = await render(<CounterpartCard userId="user-2" receiverConfirmation="confirmed" />);

    expect(getByText("Aceptó el envío")).toBeTruthy();
  });

  it("no muestra ningún badge de confirmación cuando no se pasa `receiverConfirmation` (transportista)", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "carrier-1",
        fullName: "Laura F.",
        photoUrl: null,
        isVerified: true,
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
      },
      isLoading: false,
      isError: false,
    });

    const { queryByText } = await render(<CounterpartCard userId="carrier-1" />);

    expect(queryByText("Aceptó el envío")).toBeNull();
    expect(queryByText("Pend. de aceptar")).toBeNull();
    expect(queryByText("Rechazó el envío")).toBeNull();
  });
});
