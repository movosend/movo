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
    Stack: () => {
      // Usa el Context REAL del layout (el mock de `usePickupResult` de más abajo solo
      // afecta a las pantallas hijas) para poder simular que `scan.tsx` confirmó.
      const { usePickupResult: useRealPickupResult } = jest.requireActual(
        "../app/(app)/shipments/[id]/pickup/_layout",
      );
      const { setResult } = useRealPickupResult();
      return (
        <Text testID="pickup-layout-stack" onPress={() => setResult({ stage: "pickup" })}>
          stack
        </Text>
      );
    },
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
const mockUseShipmentRoute = jest.fn(() => ({ data: undefined }));
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: (...args: unknown[]) => mockUseShipment(...args),
  useEvidenceStatus: (...args: unknown[]) => mockUseEvidenceStatus(...args),
  useShipmentRoute: () => mockUseShipmentRoute(),
}));

const mockUsePublicProfile = jest.fn<{ data: { fullName: string } | undefined }, [string | undefined]>(() => ({
  data: undefined,
}));
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (id: string | undefined) => mockUsePublicProfile(id),
}));

const mockCheck = jest.fn();
let mockProximity = {
  status: "idle" as string,
  distanceMeters: null as number | null,
  currentLocation: null as { lat: number; lng: number } | null,
  check: mockCheck,
};
jest.mock("../src/hooks/use-proximity-check", () => ({
  useProximityCheck: () => mockProximity,
  PROXIMITY_THRESHOLD_METERS: 100,
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

let mockConfirmationResultProps: { onCtaPress?: () => void } | null = null;
jest.mock("../components/handshake/handshake-confirmation-result", () => {
  const { Pressable, Text } = require("react-native");
  return {
    HandshakeConfirmationResult: (props: any) => {
      mockConfirmationResultProps = props;
      return (
        <Pressable testID={props.testID} onPress={props.onCtaPress}>
          <Text>confirmation</Text>
        </Pressable>
      );
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
import PickupGeoScreen from "../app/(app)/shipments/[id]/pickup/index";
import PickupResumenScreen from "../app/(app)/shipments/[id]/pickup/resumen";
import PickupQrNoticeScreen from "../app/(app)/shipments/[id]/pickup/qr";
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

  it("ya confirmado en esta sesión: el gate en vivo (already_done) no pisa la pantalla de éxito", async () => {
    mockUsePickupWizard.mockReturnValue({ gate: "ready" });

    const { getByTestId, queryByTestId, rerender } = await render(<PickupWizardLayout />);
    await act(async () => fireEvent.press(getByTestId("pickup-layout-stack")));

    // El backend ya pasó el envío a `in_transit` y el detalle se refetchea.
    mockUsePickupWizard.mockReturnValue({ gate: "already_done" });
    await rerender(<PickupWizardLayout />);

    expect(getByTestId("pickup-layout-stack")).toBeTruthy();
    expect(queryByTestId("pickup-wizard-already-done")).toBeNull();
  });

  it.each(["not_found", "not_carrier", "invalid_state"])("%s: mensaje bloqueado con vuelta atrás", async (gate) => {
    mockUsePickupWizard.mockReturnValue({ gate });

    const { getByTestId } = await render(<PickupWizardLayout />);

    expect(getByTestId("pickup-wizard-blocked")).toBeTruthy();
  });

  it("ready: renderiza el Stack de los pasos", async () => {
    mockUsePickupWizard.mockReturnValue({ gate: "ready" });

    const { getByTestId } = await render(<PickupWizardLayout />);

    expect(getByTestId("pickup-layout-stack")).toBeTruthy();
  });
});

describe("pickup/index (paso 1: ubicación, AC4)", () => {
  beforeEach(() => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockProximity = {
      status: "within_range",
      distanceMeters: 20,
      currentLocation: { lat: -31.4001, lng: -64.1802 },
      check: mockCheck,
    };
  });
  afterEach(() => jest.clearAllMocks());

  it("Continuar deshabilitado mientras se ubica (idle/checking)", async () => {
    mockProximity = { status: "checking", distanceMeters: null, currentLocation: null, check: mockCheck };
    const { getByTestId } = await render(<PickupGeoScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-geo-continue")));
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("dentro de rango, Continuar navega al resumen", async () => {
    const { getByTestId } = await render(<PickupGeoScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-geo-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/pickup/resumen");
  });

  it.each(["out_of_range", "denied", "error"] as const)(
    "%s: 'Reintentar ubicación' ocupa el lugar de 'Continuar'",
    async (status) => {
      mockProximity = { status, distanceMeters: 300, currentLocation: null, check: mockCheck };
      const { getByTestId, queryByTestId } = await render(<PickupGeoScreen />);

      expect(queryByTestId("pickup-geo-continue")).toBeNull();
      await act(async () => fireEvent.press(getByTestId("pickup-geo-retry")));
      expect(mockCheck).toHaveBeenCalled();
    },
  );

  it("muestra un mapa real con el pin de retiro y el pin de la ubicación actual", async () => {
    const { getByTestId } = await render(<PickupGeoScreen />);

    expect(getByTestId("pickup-geo-map")).toBeTruthy();
    // testID genérico tras la extracción a `ProximityGeoScreen` (MOVO-199): antes
    // "pickup-geo-map-pickup-marker", ahora "-target-marker" (compartido con delivery).
    expect(getByTestId("pickup-geo-map-target-marker")).toBeTruthy();
    expect(getByTestId("pickup-geo-map-you-marker")).toBeTruthy();
  });

  it("sin ubicación actual resuelta todavía, no muestra el pin de 'vos'", async () => {
    mockProximity = { status: "checking", distanceMeters: null, currentLocation: null, check: mockCheck };
    const { queryByTestId } = await render(<PickupGeoScreen />);

    expect(queryByTestId("pickup-geo-map-you-marker")).toBeNull();
  });

  it("con distancia ya medida, muestra el chip de distancia al pie del mapa", async () => {
    const { getByTestId } = await render(<PickupGeoScreen />);

    expect(getByTestId("pickup-geo-map-distance")).toHaveTextContent("20 m");
  });

  it("sin distancia todavía (GPS sin resolver), no muestra el chip de distancia", async () => {
    mockProximity = { status: "checking", distanceMeters: null, currentLocation: null, check: mockCheck };
    const { queryByTestId } = await render(<PickupGeoScreen />);

    expect(queryByTestId("pickup-geo-map-distance")).toBeNull();
  });

  it("el estado ('En el punto') y la distancia viven en la misma pill al pie del mapa", async () => {
    const { getByTestId } = await render(<PickupGeoScreen />);

    expect(getByTestId("pickup-geo-map-status")).toHaveTextContent("En el punto", { exact: false });
    expect(getByTestId("pickup-geo-map-status")).toHaveTextContent("20 m", { exact: false });
  });
});

describe("pickup/resumen (paso 2)", () => {
  beforeEach(() => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
  });
  afterEach(() => jest.clearAllMocks());

  it("muestra el punto de retiro, el emisor y el paquete", async () => {
    const { getByTestId } = await render(<PickupResumenScreen />);

    expect(getByTestId("pickup-resumen-sender")).toBeTruthy();
    expect(getByTestId("pickup-resumen-package")).toBeTruthy();
  });

  it("'Empezar el retiro' siempre navega al aviso de QR, incluso con evidencia ya satisfecha", async () => {
    const { getByTestId } = await render(<PickupResumenScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-resumen-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/pickup/qr");
  });
});

describe("pickup/qr (paso 3, AC6)", () => {
  afterEach(() => jest.clearAllMocks());

  it("sin perfil del emisor cargado, muestra el aviso genérico", async () => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockUsePublicProfile.mockReturnValue({ data: undefined });

    const { getByText } = await render(<PickupQrNoticeScreen />);

    expect(getByText("Pedile el QR al emisor")).toBeTruthy();
  });

  it("con perfil del emisor cargado, personaliza el aviso con su nombre", async () => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockUsePublicProfile.mockReturnValue({ data: { fullName: "Julia Mancini" } });

    const { getByText } = await render(<PickupQrNoticeScreen />);

    expect(getByText("Pedile el QR a Julia")).toBeTruthy();
  });

  it("'Entendido' navega al paso de evidencia", async () => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockUsePublicProfile.mockReturnValue({ data: undefined });

    const { getByTestId } = await render(<PickupQrNoticeScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-qr-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/pickup/evidence");
  });
});

describe("pickup/evidence (paso 4)", () => {
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

describe("pickup/scan (paso 5, AC3/AC9)", () => {
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

  it("si evidence-status falla sin datos, muestra el error con reintento en vez de redirigir a evidencia", async () => {
    const mockRefetch = jest.fn();
    mockUseEvidenceStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: mockRefetch,
    });

    const { getByTestId, queryByTestId } = await render(<PickupScanScreen />);

    expect(queryByTestId("pickup-redirect")).toBeNull();
    await act(async () => {
      fireEvent.press(getByTestId("evidence-status-error-retry"));
    });
    expect(mockRefetch).toHaveBeenCalled();
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

describe("pickup/success (AC10)", () => {
  afterEach(() => jest.clearAllMocks());

  it("sin resultado en contexto (reingreso directo), degrada a un mensaje simple", async () => {
    mockUsePickupResult.mockReturnValue({ result: null, setResult: jest.fn() });

    const { getByTestId } = await render(<PickupSuccessScreen />);

    expect(getByTestId("pickup-success-no-result")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("pickup-success-no-result-cta")));
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });

  it("con resultado de retiro, el CTA (horneado en HandshakeConfirmationResult) navega al mapa de ruta", async () => {
    mockUsePickupResult.mockReturnValue({ result: confirmResult, setResult: jest.fn() });

    const { getByTestId } = await render(<PickupSuccessScreen />);

    expect(getByTestId("pickup-success-result")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("pickup-success-result")));

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["shipments", "detail", "shipment-1"] });
    expect(mockRouterReplace).toHaveBeenCalledWith("/route?shipmentId=shipment-1");
  });

  it("con resultado de entrega, el CTA vuelve al detalle del envío", async () => {
    mockUsePickupResult.mockReturnValue({
      result: { ...confirmResult, stage: "delivery" },
      setResult: jest.fn(),
    });

    const { getByTestId } = await render(<PickupSuccessScreen />);

    await act(async () => fireEvent.press(getByTestId("pickup-success-result")));

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["shipments", "detail", "shipment-1"] });
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });
});
