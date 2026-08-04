import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import {
  formatDni,
  formatPhone,
  getFieldError,
  isDniValid,
  isEmailValid,
  isPasswordValid,
  isPhoneValid,
  isStepValid,
  isZipValid,
  RegistrationProvider,
  useRegistration,
  type RegistrationFields,
} from "../src/hooks/use-registration";
import { authClient } from "../src/api/auth-client";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/api/auth-client", () => ({
  authClient: {
    register: jest.fn(),
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    createKycSession: jest.fn(),
    getKycStatus: jest.fn(),
  },
}));

const BASE_FIELDS: RegistrationFields = {
  firstName: "Julia",
  lastName: "Pérez",
  email: "julia@mail.com",
  phone: "351 234 5678",
  dni: "12.345.678",
  street: "Av. Corrientes",
  number: "1234",
  floor: "",
  city: "CABA",
  province: "CABA",
  zip: "1425",
  password: "abc12345",
  passwordConfirm: "abc12345",
};

describe("validadores de registro", () => {
  it("valida emails", () => {
    expect(isEmailValid("julia@mail.com")).toBe(true);
    expect(isEmailValid("no-es-un-email")).toBe(false);
  });

  it("valida teléfonos argentinos", () => {
    expect(isPhoneValid("3512345678")).toBe(true);
    expect(isPhoneValid("123")).toBe(false);
  });

  it("formatea el teléfono en grupos", () => {
    expect(formatPhone("3512345678")).toBe("351 234 5678");
  });

  it("valida contraseñas (mínimo 8, letra y número)", () => {
    expect(isPasswordValid("abc12345")).toBe(true);
    expect(isPasswordValid("short1")).toBe(false);
    expect(isPasswordValid("sololetras")).toBe(false);
  });

  it("valida DNI de 7 u 8 dígitos", () => {
    expect(isDniValid("12345678")).toBe(true);
    expect(isDniValid("123")).toBe(false);
  });

  it("formatea el DNI con puntos", () => {
    expect(formatDni("12345678")).toBe("12.345.678");
  });

  it("valida el código postal de 4 dígitos", () => {
    expect(isZipValid("1425")).toBe(true);
    expect(isZipValid("14255")).toBe(false);
  });

  it("getFieldError devuelve mensaje por campo inválido y vacío si es válido", () => {
    expect(getFieldError("email", { ...BASE_FIELDS, email: "mal" })).toBe("Ingresá un email válido");
    expect(getFieldError("email", BASE_FIELDS)).toBe("");
    expect(getFieldError("passwordConfirm", { ...BASE_FIELDS, passwordConfirm: "otra" })).toBe(
      "Las contraseñas no coinciden",
    );
  });

  it("isStepValid agrupa la validación de cada paso del wizard", () => {
    expect(isStepValid(0, BASE_FIELDS)).toBe(true);
    expect(isStepValid(0, { ...BASE_FIELDS, email: "mal" })).toBe(false);
    expect(isStepValid(1, BASE_FIELDS)).toBe(true);
    expect(isStepValid(2, { ...BASE_FIELDS, province: "" })).toBe(false);
    expect(isStepValid(3, BASE_FIELDS)).toBe(true);
  });
});

/**
 * Harness mínimo: expone el estado del provider vía `testID`s en vez de usar
 * `renderHook` (que en esta combinación de React 19 + RNTL 14 pisa el
 * "act environment" y deja `result.current` sin definir). Un componente
 * renderizado normal es el mismo patrón que usan las pantallas reales.
 */
function Harness({ onReady }: { onReady: (ctx: ReturnType<typeof useRegistration>) => void }) {
  const ctx = useRegistration();
  onReady(ctx);
  return (
    <Text testID="harness-state">
      {JSON.stringify({ userId: ctx.userId, resumeChecked: ctx.resumeChecked, errorBanner: ctx.errorBanner })}
    </Text>
  );
}

async function renderRegistration() {
  let latest!: ReturnType<typeof useRegistration>;
  const utils = await render(
    <RegistrationProvider>
      <Harness onReady={(ctx) => (latest = ctx)} />
    </RegistrationProvider>,
  );
  return { ...utils, getCtx: () => latest };
}

describe("RegistrationProvider", () => {
  afterEach(() => jest.clearAllMocks());

  it("guarda el userId y kycStatus al registrar con éxito", async () => {
    (authClient.register as jest.Mock).mockResolvedValue({ userId: "usr_1", kycStatus: "not_started" });

    const { getCtx } = await renderRegistration();
    await waitFor(() => expect(getCtx().resumeChecked).toBe(true));

    Object.entries(BASE_FIELDS).forEach(([name, value]) =>
      getCtx().setField(name as keyof RegistrationFields, value),
    );

    let response: { ok: boolean } | undefined;
    await waitFor(async () => {
      response = await getCtx().submitRegistration();
    });

    expect(response).toEqual({ ok: true });
    await waitFor(() => expect(getCtx().userId).toBe("usr_1"));
  });

  it("mapea el error 409 de email duplicado al campo email, sin alert genérico", async () => {
    (authClient.register as jest.Mock).mockRejectedValue(
      new ApiError(409, "USER_EMAIL_ALREADY_EXISTS", "Este email ya está registrado."),
    );

    const { getCtx } = await renderRegistration();
    await waitFor(() => expect(getCtx().resumeChecked).toBe(true));

    let response: { ok: boolean } | undefined;
    response = await getCtx().submitRegistration();

    expect(response).toEqual({ ok: false });
    await waitFor(() => expect(getCtx().touched.email).toBe(true));
    expect(getCtx().errorBanner).toMatch(/email ya está registrado/i);
  });

  it("verifica el teléfono ANTES de crear la cuenta y manda el token en el alta", async () => {
    (authClient.sendOtp as jest.Mock).mockResolvedValue({ otpId: "otp_1", cooldownSeconds: 60 });
    (authClient.verifyOtp as jest.Mock).mockResolvedValue({
      phoneVerificationToken: "tok_abc",
      phoneVerifiedAt: "2026-01-01T00:00:00.000Z",
    });
    (authClient.register as jest.Mock).mockResolvedValue({ userId: "usr_1", kycStatus: "not_started" });

    const { getCtx } = await renderRegistration();
    await waitFor(() => expect(getCtx().resumeChecked).toBe(true));
    Object.entries(BASE_FIELDS).forEach(([name, value]) =>
      getCtx().setField(name as keyof RegistrationFields, value),
    );
    await waitFor(() => expect(getCtx().fields.phone).toBe(BASE_FIELDS.phone));

    let sendResult: { ok: boolean; cooldownSeconds: number } | undefined;
    await waitFor(async () => {
      sendResult = await getCtx().sendOtp();
    });
    expect(sendResult).toEqual({ ok: true, cooldownSeconds: 60 });
    expect(authClient.sendOtp).toHaveBeenCalledWith("+5493512345678");

    const verifyResult = await getCtx().verifyPhoneOtp("123456");
    expect(verifyResult).toEqual({ ok: true });
    expect(authClient.verifyOtp).toHaveBeenCalledWith({ otpId: "otp_1", code: "123456" });
    await waitFor(() => expect(getCtx().phoneVerifiedAt).toBe("2026-01-01T00:00:00.000Z"));

    await getCtx().submitRegistration();
    expect(authClient.register).toHaveBeenCalledWith(
      expect.objectContaining({ phoneVerificationToken: "tok_abc" }),
    );
  });

  it("verifyPhoneOtp no hace nada sin un OTP enviado antes", async () => {
    const { getCtx } = await renderRegistration();
    await waitFor(() => expect(getCtx().resumeChecked).toBe(true));

    const result = await getCtx().verifyPhoneOtp("123456");

    expect(result).toEqual({ ok: false });
    expect(authClient.verifyOtp).not.toHaveBeenCalled();
  });
});
