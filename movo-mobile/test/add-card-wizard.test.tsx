import { act, fireEvent, render } from "@testing-library/react-native";
import { AddCardWizard } from "../components/payments/add-card-wizard";
import { CardTokenError } from "../src/lib/mp-card-tokenizer";

type AddOptions = { onSuccess?: (card: unknown) => void; onError?: (err: unknown) => void };
const mockMutate = jest.fn();
let mockAddOptions: AddOptions = {};

jest.mock("../src/hooks/use-saved-cards", () => ({
  useCardsCheckoutData: () => ({ data: { publicKey: "TEST-pk" }, isError: false }),
  useAddSavedCard: (opts: AddOptions) => {
    mockAddOptions = opts;
    return { mutate: mockMutate, isPending: false };
  },
}));

jest.mock("../src/lib/mp-card-tokenizer", () => ({
  ...jest.requireActual("../src/lib/mp-card-tokenizer"),
  lookupBin: jest.fn(async () => ({
    paymentMethodId: "visa",
    paymentType: "credit_card",
    issuerName: "Banco Galicia",
    cardNumberLength: 16,
    securityCodeLength: 3,
  })),
}));

const EXISTING = {
  id: "c1",
  mpCardId: "mp1",
  alias: null,
  brand: "visa",
  last4: "4242",
  expMonth: 11,
  expYear: 2099,
  issuerName: null,
  paymentType: null,
  isDefault: true,
  createdAt: "2026-10-01T00:00:00.000Z",
};

async function fillUpToStep3(utils: Awaited<ReturnType<typeof render>>) {
  const { getByTestId } = utils;
  await act(async () => fireEvent.changeText(getByTestId("add-card-number"), "4075 5957 1648 3764"));
  await act(async () => fireEvent.press(getByTestId("add-card-primary")));
  await act(async () => fireEvent.changeText(getByTestId("add-card-exp"), "11/30"));
  await act(async () => fireEvent.changeText(getByTestId("add-card-cvv"), "123"));
  await act(async () => fireEvent.press(getByTestId("add-card-primary")));
}

describe("AddCardWizard (MOVO-101)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("paso 1: no avanza sin número completo y muestra el banco detectado por BIN", async () => {
    const utils = await render(<AddCardWizard cards={[EXISTING]} onSaved={jest.fn()} onCancel={jest.fn()} />);
    const { getByTestId, findByTestId } = utils;
    expect(getByTestId("add-card-step-label").props.children.join("")).toBe("Paso 1 de 3");
    expect(getByTestId("add-card-primary").props.accessibilityState.disabled).toBe(true);

    await act(async () => fireEvent.changeText(getByTestId("add-card-number"), "4075 5957 1648 3764"));
    expect(await findByTestId("add-card-bank")).toBeTruthy();
    expect(getByTestId("card-preview-bank", { includeHiddenElements: true }).props.children).toBe("Banco Galicia");
    expect(getByTestId("add-card-primary").props.accessibilityState.disabled).toBe(false);
  });

  it("recorre los 3 pasos y guarda con nombre de referencia, sin mandar nada más que lo necesario al hook (AC3, AC10)", async () => {
    const utils = await render(<AddCardWizard cards={[EXISTING]} onSaved={jest.fn()} onCancel={jest.fn()} />);
    const { getByTestId } = utils;
    await fillUpToStep3(utils);

    expect(getByTestId("add-card-step-title").props.children).toBe("Titular y nombre");
    await act(async () => fireEvent.changeText(getByTestId("add-card-name"), "Julieta Ramos"));
    await act(async () => fireEvent.changeText(getByTestId("add-card-dni"), "36789012"));
    await act(async () => fireEvent.changeText(getByTestId("add-card-alias"), " Visa del trabajo "));
    await act(async () => fireEvent.press(getByTestId("add-card-primary")));

    expect(mockMutate).toHaveBeenCalledWith({
      publicKey: "TEST-pk",
      card: {
        cardNumber: "4075595716483764",
        expMonth: 11,
        expYear: 2030,
        securityCode: "123",
        holderName: "Julieta Ramos",
        docType: "DNI",
        docNumber: "36789012",
      },
      paymentMethodId: "visa",
      alias: "Visa del trabajo",
      makeDefault: false,
    });
    expect(getByTestId("add-card-primary").props.accessibilityLabel).toBe("Validando…");
  });

  it("sin nombre de referencia lo manda vacío (AC10)", async () => {
    const utils = await render(<AddCardWizard cards={[EXISTING]} onSaved={jest.fn()} onCancel={jest.fn()} />);
    const { getByTestId } = utils;
    await fillUpToStep3(utils);
    await act(async () => fireEvent.changeText(getByTestId("add-card-name"), "Julieta Ramos"));
    await act(async () => fireEvent.changeText(getByTestId("add-card-dni"), "36789012"));
    await act(async () => fireEvent.press(getByTestId("add-card-primary")));
    expect(mockMutate.mock.calls[0][0].alias).toBeNull();
  });

  it("el nombre de referencia corta en 40 caracteres y muestra el contador (AC10)", async () => {
    const utils = await render(<AddCardWizard cards={[EXISTING]} onSaved={jest.fn()} onCancel={jest.fn()} />);
    const { getByTestId } = utils;
    await fillUpToStep3(utils);
    await act(async () => fireEvent.changeText(getByTestId("add-card-alias"), "x".repeat(50)));
    expect(getByTestId("add-card-alias").props.value).toHaveLength(40);
    expect(getByTestId("add-card-alias-counter").props.children).toBe("40/40");
  });

  it("si es la primera tarjeta vigente queda predeterminada sin poder apagarlo", async () => {
    const utils = await render(<AddCardWizard cards={[]} onSaved={jest.fn()} onCancel={jest.fn()} />);
    const { getByTestId } = utils;
    await fillUpToStep3(utils);
    expect(getByTestId("add-card-default-switch").props.accessibilityState).toEqual({ checked: true, disabled: true });
    expect(getByTestId("add-card-default-hint").props.children).toBe(
      "Es tu primera tarjeta, así que va a ser la predeterminada.",
    );
  });

  it("si MP rechaza el código vuelve al paso 2 con el motivo y permite reintentar (AC4)", async () => {
    const utils = await render(<AddCardWizard cards={[EXISTING]} onSaved={jest.fn()} onCancel={jest.fn()} />);
    const { getByTestId, findByTestId } = utils;
    await fillUpToStep3(utils);
    await act(async () => fireEvent.changeText(getByTestId("add-card-name"), "Julieta Ramos"));
    await act(async () => fireEvent.changeText(getByTestId("add-card-dni"), "36789012"));
    await act(async () => fireEvent.press(getByTestId("add-card-primary")));

    await act(async () =>
      mockAddOptions.onError?.(new CardTokenError({ reason: "invalid_security_code", field: "security_code" })),
    );
    expect(await findByTestId("add-card-error")).toBeTruthy();
    expect(getByTestId("add-card-step-title").props.children).toBe("Vencimiento y código");
    expect(getByTestId("add-card-primary").props.accessibilityLabel).toBe("Continuar");
  });

  it("al guardar avisa al caller con la tarjeta (AC6)", async () => {
    const onSaved = jest.fn();
    await render(<AddCardWizard cards={[EXISTING]} onSaved={onSaved} onCancel={jest.fn()} />);
    await act(async () => mockAddOptions.onSuccess?.({ id: "new" }));
    expect(onSaved).toHaveBeenCalledWith({ id: "new" });
  });

  it("volver en el paso 1 cancela; en el paso 2 vuelve al 1", async () => {
    const onCancel = jest.fn();
    const { getByTestId } = await render(<AddCardWizard cards={[EXISTING]} onSaved={jest.fn()} onCancel={onCancel} />);
    await act(async () => fireEvent.changeText(getByTestId("add-card-number"), "4075595716483764"));
    await act(async () => fireEvent.press(getByTestId("add-card-primary")));
    await act(async () => fireEvent.press(getByTestId("add-card-back")));
    expect(getByTestId("add-card-step-title").props.children).toBe("Número de la tarjeta");
    await act(async () => fireEvent.press(getByTestId("add-card-back")));
    expect(onCancel).toHaveBeenCalled();
  });

  it("el copy aclara que el código no se guarda (AC7)", async () => {
    const { getByText } = await render(<AddCardWizard cards={[]} onSaved={jest.fn()} onCancel={jest.fn()} />);
    expect(getByText("Se guarda cifrada en Mercado Pago. El código no se guarda.")).toBeTruthy();
  });
});
