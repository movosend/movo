import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";

const mockGetCurrentLocation = jest.fn();
jest.mock("../src/lib/location", () => ({
  getCurrentLocation: () => mockGetCurrentLocation(),
}));

const mockGenerateHandshake = jest.fn();
const mockGetById = jest.fn();
jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: {
    generateHandshake: (...args: any[]) => mockGenerateHandshake(...args),
    getById: (...args: any[]) => mockGetById(...args),
  },
}));

const mockSignHandshakeNonce = jest.fn();
jest.mock("../src/crypto/signing", () => ({
  signHandshakeNonce: (...args: any[]) => mockSignHandshakeNonce(...args),
}));

const mockUseDeviceKeyBootstrap = jest.fn();
jest.mock("../src/hooks/use-device-key-bootstrap", () => ({
  useDeviceKeyBootstrap: () => mockUseDeviceKeyBootstrap(),
}));

import {
  useHandshakeQr,
  UseHandshakeQrOptions,
  UseHandshakeQrResult,
} from "../src/hooks/use-handshake-qr";

/**
 * En React 19 + RNTL 14, `renderHook` corrompe el entorno de act entre tests
 * consecutivos en el mismo archivo. Renderizar un harness normal con `render`
 * es el patrón establecido en el repo (ver use-registration.test.tsx).
 */
function Harness({
  options,
  onUpdate,
}: {
  options: UseHandshakeQrOptions;
  onUpdate: (val: UseHandshakeQrResult) => void;
}) {
  const result = useHandshakeQr(options);
  onUpdate(result);
  return <Text testID="harness-status">{result.status}</Text>;
}

async function renderHarness(options: UseHandshakeQrOptions) {
  let latest!: UseHandshakeQrResult;
  const utils = await render(
    <Harness options={options} onUpdate={(val) => { latest = val; }} />
  );
  return {
    get current() {
      return latest;
    },
    ...utils,
  };
}

describe("useHandshakeQr (MOVO-159)", () => {
  const shipmentId = "shp-123-abc";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-19T10:00:00.000Z"));

    mockUseDeviceKeyBootstrap.mockReturnValue({
      status: "ready",
      retry: jest.fn(),
    });

    mockGetCurrentLocation.mockResolvedValue({
      granted: true,
      lat: -31.42,
      lng: -64.18,
    });

    mockGenerateHandshake.mockResolvedValue({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-xyz-456",
      canonicalPayload: `${shipmentId}:pickup:nonce-xyz-456`,
      expiresAt: "2026-09-19T10:00:15.000Z",
      ttlSeconds: 15,
    });

    mockSignHandshakeNonce.mockResolvedValue("signature-base64-mock");

    mockGetById.mockResolvedValue({
      id: shipmentId,
      status: ShipmentStatus.ASSIGNED,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("AC2: genera el nonce, lo firma con la clave del dispositivo y produce el JSON del QR", async () => {
    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    expect(mockGetCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mockGenerateHandshake).toHaveBeenCalledWith(shipmentId, {
      lat: -31.42,
      lng: -64.18,
    });
    expect(mockSignHandshakeNonce).toHaveBeenCalledWith(
      `${shipmentId}:pickup:nonce-xyz-456`
    );

    expect(harness.current.status).toBe("active");
    expect(harness.current.stage).toBe("pickup");
    expect(harness.current.secondsLeft).toBe(15);
    expect(harness.current.isExpired).toBe(false);

    const parsed = JSON.parse(harness.current.qrPayload!);
    expect(parsed).toEqual({
      shipmentId,
      nonce: "nonce-xyz-456",
      signature: "signature-base64-mock",
    });
  });

  it("AC2 & AC3: cuenta regresiva de 15 segundos y marca el QR como expirado al llegar a 0", async () => {
    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });
    expect(harness.current.secondsLeft).toBe(15);

    // Avanzar 10 segundos -> quedan 5s (isExpiringSoon = true)
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(harness.current.secondsLeft).toBe(5);
    expect(harness.current.isExpiringSoon).toBe(true);
    expect(harness.current.isExpired).toBe(false);

    // Avanzar 5 segundos más -> 15s completados -> expirado
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(harness.current.status).toBe("expired");
    expect(harness.current.secondsLeft).toBe(0);
    expect(harness.current.isExpired).toBe(true);
  });

  it("AC3: permite regenerar el código QR tras haber expirado", async () => {
    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    // Expira
    await act(async () => {
      jest.advanceTimersByTime(15500);
    });
    expect(harness.current.isExpired).toBe(true);

    mockGenerateHandshake.mockResolvedValueOnce({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-renewed-789",
      canonicalPayload: `${shipmentId}:pickup:nonce-renewed-789`,
      expiresAt: "2026-09-19T10:00:30.500Z",
      ttlSeconds: 15,
    });
    mockSignHandshakeNonce.mockResolvedValueOnce("signature-renewed-mock");

    // Regenerar
    await act(async () => {
      await harness.current.regenerate();
    });

    expect(harness.current.status).toBe("active");
    expect(harness.current.isExpired).toBe(false);
    expect(harness.current.secondsLeft).toBe(15);

    const parsed = JSON.parse(harness.current.qrPayload!);
    expect(parsed.nonce).toBe("nonce-renewed-789");
  });

  it("AC4: polling detecta confirmación del receptor y pasa a estado confirmed", async () => {
    const onConfirmedMock = jest.fn();

    const harness = await renderHarness({
      shipmentId,
      initialStage: "pickup",
      onConfirmed: onConfirmedMock,
      pollingIntervalMs: 2500,
    });

    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    // El backend responde que el envío pasó a IN_TRANSIT
    mockGetById.mockResolvedValueOnce({
      id: shipmentId,
      status: ShipmentStatus.IN_TRANSIT,
    });

    // Disparar polling
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    await waitFor(() => {
      expect(harness.current.status).toBe("confirmed");
    });
    expect(onConfirmedMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: shipmentId, status: ShipmentStatus.IN_TRANSIT })
    );
  });

  it("AC5: error claro cuando el permiso de GPS no fue otorgado", async () => {
    mockGetCurrentLocation.mockResolvedValueOnce({ granted: false });

    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("error");
    });

    expect(harness.current.error).toContain("ubicación GPS");
    expect(mockGenerateHandshake).not.toHaveBeenCalled();
  });

  it("AC5: maneja HANDSHAKE_DISTANCE_EXCEEDED con mensaje específico", async () => {
    mockGenerateHandshake.mockRejectedValueOnce(
      new ApiError(422, "HANDSHAKE_DISTANCE_EXCEEDED", "Distance exceeded")
    );

    const harness = await renderHarness({ shipmentId, initialStage: "delivery" });

    await waitFor(() => {
      expect(harness.current.status).toBe("error");
    });

    expect(harness.current.error).toContain("100 m");
  });

  it("deriva expiryTimestamp del expiresAt autoritativo del backend respetando latencia de red", async () => {
    // Si la llamada tardó 5s, el backend devolvió expiresAt con solo 10s restantes respecto a Date.now()
    mockGenerateHandshake.mockResolvedValueOnce({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-latency",
      canonicalPayload: `${shipmentId}:pickup:nonce-latency`,
      expiresAt: "2026-09-19T10:00:10.000Z", // 10s desde 10:00:00
      ttlSeconds: 15,
    });

    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    expect(harness.current.secondsLeft).toBe(10);
    expect(harness.current.totalSeconds).toBe(15);
  });

  it("expira inmediatamente si el expiresAt del backend ya venció en tránsito", async () => {
    mockGenerateHandshake.mockResolvedValueOnce({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-expired-backend",
      canonicalPayload: `${shipmentId}:pickup:nonce-expired-backend`,
      expiresAt: "2026-09-19T09:59:59.000Z", // 1s en el pasado respecto a 10:00:00
      ttlSeconds: 15,
    });

    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("expired");
    });

    expect(harness.current.secondsLeft).toBe(0);
    expect(harness.current.isExpired).toBe(true);
  });

  it("utiliza fallback a Date.now() + ttl * 1000 si expiresAt es inválido o no está presente", async () => {
    mockGenerateHandshake.mockResolvedValueOnce({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-no-expires",
      canonicalPayload: `${shipmentId}:pickup:nonce-no-expires`,
      expiresAt: "",
      ttlSeconds: 12,
    });

    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    expect(harness.current.secondsLeft).toBe(12);
    expect(harness.current.totalSeconds).toBe(12);
  });
});
