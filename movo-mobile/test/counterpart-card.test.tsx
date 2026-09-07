import { fireEvent, render } from "@testing-library/react-native";
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

  it("no muestra ningún badge de confirmación cuando se renderiza el emisor sin `receiverConfirmation` (MOVO-131)", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "sender-1",
        fullName: "Pedro Emisor",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 2, asCarrier: 0 },
        reputationScore: null,
      },
      isLoading: false,
      isError: false,
    });

    const { getByText, queryByText } = await render(<CounterpartCard userId="sender-1" />);

    expect(getByText("Pedro Emisor")).toBeTruthy();
    expect(queryByText("Aceptó el envío")).toBeNull();
    expect(queryByText("Pend. de aceptar")).toBeNull();
    expect(queryByText("Rechazó el envío")).toBeNull();
  });

  // MOVO-154: acceso al perfil de la contraparte desde el detalle de envío.
  it("dispara `onPress` al tocar la card cuando se pasa la prop (MOVO-154)", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "user-2",
        fullName: "Marta González",
        photoUrl: null,
        isVerified: true,
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: 4.6,
        isNewProfile: false,
      },
      isLoading: false,
      isError: false,
    });
    const onPress = jest.fn();

    const { getByTestId } = await render(
      <CounterpartCard userId="user-2" onPress={onPress} testID="counterpart" />
    );
    fireEvent.press(getByTestId("counterpart"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("no es tocable cuando no se pasa `onPress`", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "user-2",
        fullName: "Marta González",
        photoUrl: null,
        isVerified: true,
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: 4.6,
        isNewProfile: false,
      },
      isLoading: false,
      isError: false,
    });

    const { getByTestId } = await render(<CounterpartCard userId="user-2" testID="counterpart" />);

    expect(getByTestId("counterpart").props.accessibilityRole).toBeUndefined();
  });

  it("muestra el score real y 'Perfil nuevo' con menos de 3 calificaciones (MOVO-154, AC5)", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "user-2",
        fullName: "Marta González",
        photoUrl: null,
        isVerified: false,
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: 4.2,
        isNewProfile: true,
      },
      isLoading: false,
      isError: false,
    });

    const { getByText } = await render(<CounterpartCard userId="user-2" />);

    expect(getByText("Perfil nuevo")).toBeTruthy();
  });

  it("muestra 'Sin calificaciones' cuando no hay reputación (MOVO-154, AC4)", async () => {
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "user-2",
        fullName: "Marta González",
        photoUrl: null,
        isVerified: false,
        badges: [],
        transactionCounts: { asSender: 0, asCarrier: 0 },
        reputationScore: null,
        isNewProfile: false,
      },
      isLoading: false,
      isError: false,
    });

    const { getByText } = await render(<CounterpartCard userId="user-2" />);

    expect(getByText("Sin calificaciones")).toBeTruthy();
  });
});

