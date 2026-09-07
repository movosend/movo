import { act, fireEvent, render } from "@testing-library/react-native";
import { KycStatus } from "@movo/shared/dist/types/user";
import { ProfileLicenseStatusBanner } from "../components/profile/profile-license-status-banner";

// MOVO-15 (rediseño post-feedback): banner de "Perfil verificado X/2" con barra de
// progreso, reemplaza el banner con ícono/tono por estado.
describe("ProfileLicenseStatusBanner", () => {
  it("no muestra nada cuando el estado es approved", async () => {
    const { queryByTestId } = await render(
      <ProfileLicenseStatusBanner testID="banner" status={KycStatus.APPROVED} onPrimaryAction={jest.fn()} />,
    );
    expect(queryByTestId("banner")).toBeNull();
  });

  it("muestra el progreso fijo 1/2 y el CTA correspondiente al estado", async () => {
    const { getByText } = await render(
      <ProfileLicenseStatusBanner testID="banner" status={KycStatus.NOT_STARTED} onPrimaryAction={jest.fn()} />,
    );

    expect(getByText("Perfil verificado")).toBeTruthy();
    expect(getByText("1/2")).toBeTruthy();
    expect(getByText("Subir licencia")).toBeTruthy();
  });

  it("dispara onPrimaryAction al tocar el CTA principal", async () => {
    const onPrimaryAction = jest.fn();
    const { getByTestId } = await render(
      <ProfileLicenseStatusBanner testID="banner" status={KycStatus.NOT_STARTED} onPrimaryAction={onPrimaryAction} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("banner-primary"));
    });
    expect(onPrimaryAction).toHaveBeenCalled();
  });

  it("'Después' oculta la card (solo estado local, sin persistencia)", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ProfileLicenseStatusBanner testID="banner" status={KycStatus.NOT_STARTED} onPrimaryAction={jest.fn()} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId("banner-dismiss"));
    });
    expect(queryByTestId("banner")).toBeNull();
  });
});
