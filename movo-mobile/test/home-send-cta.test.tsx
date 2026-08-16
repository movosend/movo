import { KycStatus } from "@movo/shared/dist/types/user";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { HomeSendCta } from "../components/home/home-send-cta";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

// MOVO-83 AC1: CTA primaria de Inicio, bloqueada hasta que el KYC de identidad esté aprobado.
describe("HomeSendCta", () => {
  afterEach(() => jest.clearAllMocks());

  it("navega a /send al tocarla con KYC aprobado", async () => {
    const { getByTestId } = await render(<HomeSendCta testID="cta" kycStatus={KycStatus.APPROVED} />);

    fireEvent.press(getByTestId("cta"));

    expect(router.push).toHaveBeenCalledWith("/send");
  });

  it("no navega si el KYC todavía no está aprobado", async () => {
    const { getByTestId } = await render(<HomeSendCta testID="cta" kycStatus={KycStatus.PENDING} />);

    fireEvent.press(getByTestId("cta"));

    expect(router.push).not.toHaveBeenCalled();
  });

  it("no navega si no hay kycStatus todavía (perfil sin cargar)", async () => {
    const { getByTestId } = await render(<HomeSendCta testID="cta" kycStatus={undefined} />);

    fireEvent.press(getByTestId("cta"));

    expect(router.push).not.toHaveBeenCalled();
  });

  it("muestra el copy de bloqueo cuando el KYC no está aprobado", async () => {
    const { getByText } = await render(<HomeSendCta testID="cta" kycStatus={KycStatus.REJECTED} />);

    expect(getByText("Verificá tu identidad para empezar a enviar")).toBeTruthy();
  });

  it("muestra el copy habilitado cuando el KYC está aprobado", async () => {
    const { getByText } = await render(<HomeSendCta testID="cta" kycStatus={KycStatus.APPROVED} />);

    expect(getByText("Coordiná un envío con un transportista verificado")).toBeTruthy();
  });
});
