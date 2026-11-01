import { KycStatus } from "@movo/shared/dist/types/user";
import { act, fireEvent, render } from "@testing-library/react-native";
import {
  CarrierRequirementsChecklist,
  CarrierRequirementsScreen,
  CarrierRequirementsSheet,
  type CarrierRequirementsChecklistProps,
} from "../components/carrier/carrier-requirements-checklist";

const base: CarrierRequirementsChecklistProps = {
  missing: ["license", "mp_account"],
  licenseStatus: KycStatus.NOT_STARTED,
  mpStatus: "unlinked",
  context: "offer",
  onPressLicense: jest.fn(),
  onPressMp: jest.fn(),
  onLater: jest.fn(),
  testID: "cl",
};

describe("CarrierRequirementsChecklist (MOVO-117)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("variante: faltan las dos", () => {
    it("muestra 0/2, las dos filas pendientes con su CTA y la intro del contexto", async () => {
      const { getByTestId, getByText, queryByText } = await render(<CarrierRequirementsChecklist {...base} />);

      expect(getByText("Te falta completar esto\npara transportar")).toBeTruthy();
      expect(getByTestId("cl-counter").props.children).toEqual([0, "/", 2]);
      expect(getByText("Para ofertar en este envío necesitás completar estos dos pasos.")).toBeTruthy();
      expect(getByText("Licencia de conducir verificada")).toBeTruthy();
      expect(getByText("Cuenta de Mercado Pago vinculada")).toBeTruthy();
      expect(getByText("Verificamos que puedas manejar el vehículo con el que viajás.")).toBeTruthy();
      expect(getByText("Ahí te acreditamos lo que cobrás por cada envío.")).toBeTruthy();
      expect(getByText("Verificar mi licencia")).toBeTruthy();
      expect(getByText("Vincular Mercado Pago")).toBeTruthy();
      expect(queryByText("Listo")).toBeNull();
    });

    it("la barra tiene los dos segmentos apagados", async () => {
      const { getByTestId } = await render(<CarrierRequirementsChecklist {...base} />);

      expect(getByTestId("cl-seg-1").props.className).toContain("bg-bg-mute");
      expect(getByTestId("cl-seg-2").props.className).toContain("bg-bg-mute");
    });

    it("los CTA llaman a su handler", async () => {
      const { getByTestId } = await render(<CarrierRequirementsChecklist {...base} />);

      await fireEvent.press(getByTestId("cl-license-cta"));
      await fireEvent.press(getByTestId("cl-mp-cta"));

      expect(base.onPressLicense).toHaveBeenCalledTimes(1);
      expect(base.onPressMp).toHaveBeenCalledTimes(1);
    });

    it("'Después' llama a onLater", async () => {
      const { getByTestId } = await render(<CarrierRequirementsChecklist {...base} />);

      await fireEvent.press(getByTestId("cl-later"));

      expect(base.onLater).toHaveBeenCalledTimes(1);
    });
  });

  describe("variante: falta solo la licencia", () => {
    const props = { ...base, missing: ["license" as const], mpStatus: "linked" as const };

    it("muestra 1/2, Mercado Pago en Listo sin CTA y un solo paso", async () => {
      const { getByTestId, getByText, queryByTestId } = await render(<CarrierRequirementsChecklist {...props} />);

      expect(getByTestId("cl-counter").props.children).toEqual([1, "/", 2]);
      expect(getByText("Para ofertar en este envío te queda un solo paso.")).toBeTruthy();
      expect(getByText("Vinculada. Tus cobros van a esa cuenta.")).toBeTruthy();
      expect(getByTestId("cl-mp-pill")).toBeTruthy();
      expect(queryByTestId("cl-mp-cta")).toBeNull();
      expect(getByTestId("cl-license-cta")).toBeTruthy();
      expect(getByTestId("cl-seg-1").props.className).toContain("bg-lime-500");
      expect(getByTestId("cl-seg-2").props.className).toContain("bg-bg-mute");
    });
  });

  describe("variante: falta solo Mercado Pago", () => {
    const props = { ...base, missing: ["mp_account" as const], licenseStatus: KycStatus.APPROVED };

    it("muestra 1/2, licencia en Listo sin CTA y el de MP", async () => {
      const { getByTestId, getByText, queryByTestId } = await render(<CarrierRequirementsChecklist {...props} />);

      expect(getByTestId("cl-counter").props.children).toEqual([1, "/", 2]);
      expect(getByText("Verificada. Ya tenés la insignia de licencia.")).toBeTruthy();
      expect(queryByTestId("cl-license-cta")).toBeNull();
      expect(getByTestId("cl-mp-cta")).toBeTruthy();
    });
  });

  it("licencia en revisión: pill 'En revisión' y CTA 'Ver estado'", async () => {
    const { getByText, queryByText } = await render(
      <CarrierRequirementsChecklist {...base} missing={["license"]} licenseStatus={KycStatus.MANUAL_REVIEW} mpStatus="linked" />,
    );

    expect(getByText("En revisión")).toBeTruthy();
    expect(getByText("Ver estado")).toBeTruthy();
    expect(queryByText("Verificar mi licencia")).toBeNull();
  });

  it("si el backend dice que falta la licencia pero el cliente la tiene aprobada, se muestra pendiente", async () => {
    const { getByText } = await render(
      <CarrierRequirementsChecklist {...base} missing={["license"]} licenseStatus={KycStatus.APPROVED} mpStatus="linked" />,
    );

    expect(getByText("Verificar mi licencia")).toBeTruthy();
  });

  it.each([
    ["trip", "Para declarar tu viaje"],
    ["start", "Para iniciar tu viaje"],
    ["edit_offer", "Para editar tu oferta"],
    ["gate", "Para ver y ofertar envíos"],
  ] as const)("el contexto %s cambia la frase de introducción", async (context, intro) => {
    const { getByText } = await render(<CarrierRequirementsChecklist {...base} context={context} />);

    expect(getByText(`${intro} necesitás completar estos dos pasos.`)).toBeTruthy();
  });

  it("sin onLater no se muestra 'Después'", async () => {
    const { queryByTestId } = await render(<CarrierRequirementsChecklist {...base} onLater={undefined} />);

    expect(queryByTestId("cl-later")).toBeNull();
  });
});

describe("CarrierRequirementsScreen (contenedor de pantalla completa)", () => {
  it("tiene pull-to-refresh", async () => {
    const onRefresh = jest.fn();
    const { getByTestId } = await render(
      <CarrierRequirementsScreen {...base} testID="screen" refreshing={false} onRefresh={onRefresh} />,
    );

    await act(async () => {
      getByTestId("screen").props.refreshControl.props.onRefresh();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("CarrierRequirementsSheet (contenedor de bottom sheet)", () => {
  const sheetProps = {
    missing: base.missing,
    licenseStatus: base.licenseStatus,
    mpStatus: base.mpStatus,
    context: base.context,
  };

  it("cerrado no renderiza nada", async () => {
    const { queryByTestId } = await render(
      <CarrierRequirementsSheet {...sheetProps} visible={false} onClose={jest.fn()} onPressLicense={jest.fn()} onPressMp={jest.fn()} />,
    );

    expect(queryByTestId("carrier-requirements-sheet")).toBeNull();
  });

  it("abierto muestra la checklist; 'Después' y el backdrop lo cierran", async () => {
    const onClose = jest.fn();
    const { getByTestId, getByText } = await render(
      <CarrierRequirementsSheet {...sheetProps} visible onClose={onClose} onPressLicense={jest.fn()} onPressMp={jest.fn()} />,
    );

    expect(getByText("Te falta completar esto\npara transportar")).toBeTruthy();

    await fireEvent.press(getByTestId("carrier-requirements-sheet-checklist-later"));
    await fireEvent.press(getByTestId("carrier-requirements-sheet-backdrop"));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("un CTA cierra el sheet y navega recién cuando terminó de cerrarse", async () => {
    const onClose = jest.fn();
    const onPressMp = jest.fn();
    const props = { ...sheetProps, onClose, onPressLicense: jest.fn(), onPressMp };
    const { getByTestId, rerender } = await render(<CarrierRequirementsSheet {...props} visible />);

    await fireEvent.press(getByTestId("carrier-requirements-sheet-checklist-mp-cta"));

    expect(onClose).toHaveBeenCalledTimes(1);
    // Todavía abierto: iOS no presenta una pantalla nueva con el Modal encima.
    expect(onPressMp).not.toHaveBeenCalled();

    await rerender(<CarrierRequirementsSheet {...props} visible={false} />);

    expect(onPressMp).toHaveBeenCalledTimes(1);
  });
});

describe("CarrierRequirementsChecklist — tope de deuda para efectivo (MOVO-37)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("con licencia y MP al día muestra solo el paso del tope, con su CTA a pagar el saldo", async () => {
    const onPressDebt = jest.fn();
    const { getByTestId, getByText, queryByTestId } = await render(
      <CarrierRequirementsChecklist
        {...base}
        missing={["cash_debt_within_limit"]}
        licenseStatus={KycStatus.APPROVED}
        mpStatus="linked"
        onPressDebt={onPressDebt}
      />,
    );

    expect(getByTestId("cl-counter").props.children).toEqual([2, "/", 3]);
    expect(getByText("Para ofertar en este envío te queda un solo paso.")).toBeTruthy();
    expect(getByText("Saldo por encima del tope para efectivo")).toBeTruthy();
    expect(queryByTestId("cl-debt")).toBeNull();
    expect(getByTestId("cl-seg-3")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("cl-cash-debt-cta"));
    });
    expect(onPressDebt).toHaveBeenCalledTimes(1);
  });

  it("con deuda vencida y tope a la vez dibuja las dos filas de deuda", async () => {
    const { getByTestId, getByText } = await render(
      <CarrierRequirementsChecklist
        {...base}
        missing={["no_overdue_debt", "cash_debt_within_limit"]}
        licenseStatus={KycStatus.APPROVED}
        mpStatus="linked"
      />,
    );

    expect(getByTestId("cl-counter").props.children).toEqual([2, "/", 4]);
    expect(getByText("Para ofertar en este envío necesitás completar estos dos pasos.")).toBeTruthy();
    expect(getByTestId("cl-debt")).toBeTruthy();
    expect(getByTestId("cl-cash-debt")).toBeTruthy();
  });
});
