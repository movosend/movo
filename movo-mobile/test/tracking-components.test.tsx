import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { TrackingActiveIndicator } from "../components/location/tracking-active-indicator";
import { TrackingPermissionModal } from "../components/location/tracking-permission-modal";

let mockTrackingState = {
  isTracking: false,
  inTransitCount: 0,
  pendingQueueCount: 0,
  permissionGranted: true as boolean | null,
  lastReportedAt: null as string | null,
  lastError: null as string | null,
  requestPermission: jest.fn(),
  flushQueue: jest.fn(),
};

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("../src/hooks/use-carrier-tracking", () => ({
  useCarrierTracking: () => mockTrackingState,
}));

jest.mock("../src/hooks/use-theme-colors", () => ({
  useThemeColors: () => ({
    fg: "#FFFFFF",
    fg1: "#FFFFFF",
    fg2: "#A1A1AA",
    fg3: "#71717A",
    border: "#27272A",
    bg: "#0A0A0B",
    bgSub: "#111113",
  }),
}));

describe("Componentes de Tracking (MOVO-203)", () => {
  beforeEach(() => {
    mockTrackingState = {
      isTracking: false,
      inTransitCount: 0,
      pendingQueueCount: 0,
      permissionGranted: true,
      lastReportedAt: null,
      lastError: null,
      requestPermission: jest.fn(),
      flushQueue: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("TrackingPermissionModal (AC4)", () => {
    it("renderiza el modal explicativo y dispara onAccept al aceptar", async () => {
      const onAccept = jest.fn();
      const onDismiss = jest.fn();

      const { getByText, getByTestId } = await render(
        <TrackingPermissionModal visible={true} onAccept={onAccept} onDismiss={onDismiss} />
      );

      expect(getByText("Ubicación en vivo durante el envío")).toBeTruthy();
      expect(getByText("Entendido, activar ubicación")).toBeTruthy();

      await fireEvent.press(getByTestId("tracking-permission-modal-accept-btn"));
      expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it("dispara onDismiss al presionar Ahora no", async () => {
      const onAccept = jest.fn();
      const onDismiss = jest.fn();

      const { getByTestId } = await render(
        <TrackingPermissionModal visible={true} onAccept={onAccept} onDismiss={onDismiss} />
      );

      await fireEvent.press(getByTestId("tracking-permission-modal-dismiss-btn"));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("TrackingActiveIndicator (AC8)", () => {
    it("no renderiza nada cuando no hay envíos en camino ni tracking activo", async () => {
      const { queryByTestId } = await render(<TrackingActiveIndicator />);
      expect(queryByTestId("tracking-active-indicator")).toBeNull();
    });

    it("muestra estado activo cuando hay envíos en camino (AC8)", async () => {
      mockTrackingState = {
        isTracking: true,
        inTransitCount: 2,
        pendingQueueCount: 0,
        permissionGranted: true,
        lastReportedAt: "2026-09-23T12:00:00.000Z",
        lastError: null,
        requestPermission: jest.fn(),
        flushQueue: jest.fn(),
      };

      const { getByText, getByTestId } = await render(<TrackingActiveIndicator />);

      expect(getByTestId("tracking-active-indicator")).toBeTruthy();
      expect(getByText("Transmitiendo ubicación en vivo")).toBeTruthy();
      expect(getByText("2 envíos en camino")).toBeTruthy();
    });

    it("muestra advertencia cuando el permiso fue denegado (AC5)", async () => {
      mockTrackingState = {
        isTracking: true,
        inTransitCount: 1,
        pendingQueueCount: 0,
        permissionGranted: false,
        lastReportedAt: null,
        lastError: "PERMISSION_DENIED",
        requestPermission: jest.fn(),
        flushQueue: jest.fn(),
      };

      const { getByText } = await render(<TrackingActiveIndicator />);

      expect(getByText("Permiso de ubicación requerido")).toBeTruthy();
    });

    it("muestra indicador de sin conexión a internet cuando hay posiciones pendientes (AC6)", async () => {
      mockTrackingState = {
        isTracking: true,
        inTransitCount: 1,
        pendingQueueCount: 3,
        permissionGranted: true,
        lastReportedAt: null,
        lastError: null,
        requestPermission: jest.fn(),
        flushQueue: jest.fn(),
      };

      const { getByText } = await render(<TrackingActiveIndicator />);

      expect(getByText("Sin conexión a internet")).toBeTruthy();
      expect(
        getByText("Tu ubicación se transmitirá a los participantes de tus envíos una vez que se restablezca")
      ).toBeTruthy();
    });

    it("abre el modal de detalles al presionar el indicador", async () => {
      mockTrackingState = {
        isTracking: true,
        inTransitCount: 1,
        pendingQueueCount: 0,
        permissionGranted: true,
        lastReportedAt: "2026-09-23T12:00:00.000Z",
        lastError: null,
        requestPermission: jest.fn(),
        flushQueue: jest.fn(),
      };

      const { getByTestId, getByText } = await render(<TrackingActiveIndicator />);

      await fireEvent.press(getByTestId("tracking-active-indicator"));

      expect(getByText("Seguimiento de entregas")).toBeTruthy();
      expect(getByText("Transmisión GPS del transportista")).toBeTruthy();
    });
  });
});
