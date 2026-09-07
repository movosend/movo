import { render } from "@testing-library/react-native";
import { VerificationChips } from "../components/profile/verification-chips";

describe("VerificationChips", () => {
  it("muestra identidad y licencia cuando están verificadas", async () => {
    const { getByText, queryByText } = await render(
      <VerificationChips isIdentityVerified isLicenseVerified />
    );

    expect(getByText("Identidad")).toBeTruthy();
    expect(getByText("Licencia")).toBeTruthy();
    expect(queryByText("Teléfono")).toBeNull();
    expect(queryByText("Email")).toBeNull();
  });

  it("muestra teléfono/email solo cuando el backend los expone (MOVO-170)", async () => {
    const { getByText } = await render(
      <VerificationChips
        isIdentityVerified={false}
        isLicenseVerified={false}
        isPhoneVerified
        isEmailVerified={false}
      />
    );

    expect(getByText("Teléfono")).toBeTruthy();
  });

  it("no renderiza nada si no hay ninguna verificación (nunca 'no verificado')", async () => {
    const { toJSON } = await render(
      <VerificationChips isIdentityVerified={false} isLicenseVerified={false} />
    );

    expect(toJSON()).toBeNull();
  });
});
