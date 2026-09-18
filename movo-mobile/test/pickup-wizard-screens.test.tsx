import { act, fireEvent, render } from "@testing-library/react-native";

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockUseLocalSearchParams = jest.fn(() => ({ id: "shipment-1" }));
const mockInvalidateQueries = jest.fn();

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return {
    router: {
      replace: (...args: unknown[]) => mockRouterReplace(...args),
      back: (...args: unknown[]) => mockRouterBack(...args),
      push: (...args: unknown[]) => mockRouterPush(...args),
      canGoBack: () => mockCanGoBack(),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    Stack: () => <Text testID="pickup-layout-stack">stack</Text>,
    Redirect: ({ href }: { href: string }) => <Text testID="pickup-redirect">{href}</Text>,
  };
});

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const mockUsePickupWizard = jest.fn();
jest.mock("../src/hooks/use-pickup-wizard", () => ({
  usePickupWizard: (id: string | undefined) => mockUsePickupWizard(id),
}));

const mockUseShipment = jest.fn();
const mockUseEvidenceStatus = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: (...args: unknown[]) => mockUseShipment(...args),
  useEvidenceStatus: (...args: unknown[]) => mockUseEvidenceStatus(...args),
}));

const mockCheck = jest.fn();
let mockProximity = { status: "idle" as string, distanceMeters: null as number | null, check: mockCheck };
jest.mock("../src/hooks/use-pickup-proximity-check", () => ({
  usePickupProximityCheck: () => mockProximity,
}));

jest.mock("../components/shipments/counterpart-card", () => {
  const { Text } = require("react-native");
  return { CounterpartCard: ({ testID }: { testID?: string }) => <Text testID={testID}>counterpart</Text> };
});

jest.mock("../components/shipments/package-card", () => {
  const { Text } = require("react-native");
  return { PackageCard: ({ testID }: { testID?: string }) => <Text testID={testID}>package</Text> };
});

jest.mock("../components/evidence/evidence-capture-step", () => {
  const { Pressable } = require("react-native");
  return {
    EvidenceCaptureStep: ({ onValidityChange }: { onValidityChange: (v: boolean) => void }) => (
      <Pressable testID="evidence-step-mock-mark-valid" onPress={() => onValidityChange(true)} />
    ),
  };
});

let mockHandshakeProps: { onConfirmed: (r: unknown) => void; onEvidenceMissing?: () => void } | null = null;
jest.mock("../components/handshake/handshake-scan-step", () => {
  const { View } = require("react-native");
  return {
    HandshakeScanStep: (props: any) => {
      mockHandshakeProps = props;
      return <View testID={props.testID} />;
    },
  };
});

const mockUsePickupResult = jest.fn();
jest.mock("../app/(app)/shipments/[id]/pickup/_layout", () => {
  // `__esModule: true` explícito -- `actual` (transpilado por Babel) lo tiene como
  // no-enumerable, así que `{...actual}` lo pierde, y sin ese flag el default
  // export de este mock queda envuelto de más por `_interopRequireDefault` en
  // cualquier test que importe `PickupWizardLayout` (el propio `_layout`).
  const actual = jest.requireActual("../app/(app)/shipments/[id]/pickup/_layout");
  return { __esModule: true, ...actual, usePickupResult: () => mockUsePickupResult() };
});

import PickupWizardLayout from "../app/(app)/shipments/[id]/pickup/_layout";
import PickupSummaryScreen from "../app/(app)/shipments/[id]/pickup/index";
import PickupEvidenceScreen from "../app/(app)/shipments/[id]/pickup/evidence";
import PickupScanScreen from "../app/(app)/shipments/[id]/pickup/scan";
import PickupSuccessScreen from "../app/(app)/shipments/[id]/pickup/success";

function shipment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "shipment-1",
    senderId: "sender-1",
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    pickupDate: "2026-09-20",
    pickupTimeWindowStart: "09:00:00",
    pickupTimeWindowEnd: "12:00:00",
    packageType: "small_box",
    weightKg: 2,
    ...overrides,
  };
}

const confirmResult = {
  shipmentId: "shipment-1",
  stage: "pickup" as const,
  previousStatus: "assigned" as const,
  status: "in_transit" as const,
  distanceM: 12.5,
  confirmedAt: "2026-09-20T10:00:00.000Z",
};

describe("_layout (gate del wizard de retiro, AC1)", () => {
  afterEach(() => jest.clearAllMocks());

  it("loading: no renderiza el Stack ni ningún mensaje", async () => {
    mockUsePickupWizard.mockReturnValue({ gate: "loading" });

    const { getByTestId, queryByTestId } = await render(<PickupWizardLayout />);

    expect(getByTestId("pickup-wizard-loading")).toBeTruthy();
    expect(queryByTestId("pickup-layout-stack")).toBeNull();
  });

  it("unfunded: explica que el hold todavía no se creó, no un error genérico", async () => {
    mockUsePickupWizard.mockReturnValue({ gate: "unfunded" });

    const { getByTestId } = await render(<PickupWizardLayout />);

    expect(getByTestId("pickup-wizard-unfunded")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("pickup-wizard-unfunded-cta")));
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });

  it("already_done: no vuelve a mostrar el flujo de escaneo", async () => {
    mockUsePickupWizard.mockReturnValue({ gate: "already_done" });

    const { getByTestId } = await render(<PickupWizardLayout />);

    expect(getByTestId("pickup-wizard-already-done")).toBeTruthy();
  });

  it.each(["not_found", "not_carrier", "invalid_state"])("%s: mensaje bloqueado con vuelta atrás", async (gate) => {
    mockUsePickupWizard.mockReturnValue({ gate });

    const { getByTestId } = await render(<PickupWizardLayout />);

    expect(getByTestId("pickup-wizard-blocked")).toBeTruthy();
  });

  it("ready: renderiza el Stack de los 4 pasos", async () => {
    mockUsePickupWizard.mockReturnValue({ gate: "ready" });

    const { getByTestId } = await render(<PickupWizardLayout />);

    expect(getByTestId("pickup-layout-stack")).toBeTruthy();
  });
});

describe("pickup/index (paso 1: resumen + proximidad + AC6)", () => {
  beforeEach(() => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: false }, isLoading: false });
    mockProximity = { status: "within_range", distanceMeters: 20, check: mockCheck };
  });
  afterEach(() => jest.clearAllMocks());

  it("muestra el aviso explícito de pedirle el QR al emisor (AC6)", async () => {
    const { getByTestId } = await render(<PickupSummaryScreen />);
    expect(getByTestId("pickup-summary-qr-reminder")).toBeTruthy();
  });

  it("Continuar deshabilitado hasta estar dentro del radio de proximidad (AC4)", async () => {
    mockProximity = { status: "out_of_range", distanceMeters: 300, check: mockCheck };
    const { getByTestId } = await render(<PickupSummaryScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-summary-continue")));
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("Continuar sin evidencia satisfecha navega al paso de evidencia", async () => {
    const { getByTestId } = await render(<PickupSummaryScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-summary-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/pickup/evidence");
  });

  it("Continuar con evidencia ya satisfecha salta directo a escaneo (AC7)", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });
    const { getByTestId } = await render(<PickupSummaryScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-summary-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/pickup/scan");
  });
});

describe("pickup/evidence (paso 2)", () => {
  afterEach(() => jest.clearAllMocks());

  it("Continuar deshabilitado hasta que el step reporte validez, después navega a escaneo", async () => {
    const { getByTestId } = await render(<PickupEvidenceScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-evidence-continue")));
    expect(mockRouterPush).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(getByTestId("evidence-step-mock-mark-valid")));
    await act(async () => fireEvent.press(getByTestId("pickup-evidence-continue")));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/pickup/scan");
  });
});

describe("pickup/scan (paso 3, AC3/AC9)", () => {
  beforeEach(() => {
    mockUsePickupResult.mockReturnValue({ result: null, setResult: jest.fn() });
  });
  afterEach(() => jest.clearAllMocks());

  it("sin evidencia satisfecha, redirige al paso de evidencia en vez de escanear (AC3)", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: false }, isLoading: false });

    const { getByTestId, queryByTestId } = await render(<PickupScanScreen />);

    expect(getByTestId("pickup-redirect")).toHaveTextContent("/shipments/shipment-1/pickup/evidence");
    expect(queryByTestId("pickup-scan-step")).toBeNull();
  });

  it("con evidencia satisfecha, monta HandshakeScanStep", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });

    const { getByTestId } = await render(<PickupScanScreen />);

    expect(getByTestId("pickup-scan-step")).toBeTruthy();
  });

  it("onConfirmed guarda el resultado y navega a success", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });
    const mockSetResult = jest.fn();
    mockUsePickupResult.mockReturnValue({ result: null, setResult: mockSetResult });

    await render(<PickupScanScreen />);
    mockHandshakeProps?.onConfirmed(confirmResult);

    expect(mockSetResult).toHaveBeenCalledWith(confirmResult);
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1/pickup/success");
  });

  it("onEvidenceMissing invalida evidence-status y vuelve al paso de evidencia (AC9)", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });

    await render(<PickupScanScreen />);
    mockHandshakeProps?.onEvidenceMissing?.();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["shipments", "detail", "shipment-1", "evidence-status"],
    });
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1/pickup/evidence");
  });
});

describe("pickup/success (paso 4, AC10)", () => {
  afterEach(() => jest.clearAllMocks());

  it("sin resultado en contexto (reingreso directo), degrada a un mensaje simple", async () => {
    mockUsePickupResult.mockReturnValue({ result: null, setResult: jest.fn() });

    const { getByTestId } = await render(<PickupSuccessScreen />);

    expect(getByTestId("pickup-success-no-result")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("pickup-success-no-result-cta")));
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });

  it("con resultado, muestra la confirmación e invalida el detalle antes de volver", async () => {
    mockUsePickupResult.mockReturnValue({ result: confirmResult, setResult: jest.fn() });

    const { getByTestId } = await render(<PickupSuccessScreen />);

    expect(getByTestId("pickup-success-result")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("pickup-success-cta")));

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["shipments", "detail", "shipment-1"] });
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });
});
