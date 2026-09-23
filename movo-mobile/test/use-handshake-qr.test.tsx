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

    const parsed = JSON.parse(harness.current.qrPayload!);
    expect(parsed).toEqual({
      shipmentId,
      nonce: "nonce-xyz-456",
      signature: "signature-base64-mock",
    });
  });

  it("renueva el QR solo, 3s antes de que venza, sin pasar por un estado de spinner ni expirado", async () => {
    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });

    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    mockGenerateHandshake.mockResolvedValueOnce({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-renewed-789",
      canonicalPayload: `${shipmentId}:pickup:nonce-renewed-789`,
      expiresAt: "2026-09-19T10:00:27.000Z",
      ttlSeconds: 15,
    });
    mockSignHandshakeNonce.mockResolvedValueOnce("signature-renewed-mock");

    // A los 11.9s todavía no se pidió el nonce siguiente.
    await act(async () => {
      jest.advanceTimersByTime(11900);
    });
    expect(mockGenerateHandshake).toHaveBeenCalledTimes(1);

    // A los 12s (15s - 3s de margen) arranca la renovación.
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(JSON.parse(harness.current.qrPayload!).nonce).toBe("nonce-renewed-789");
    });
    expect(mockGenerateHandshake).toHaveBeenCalledTimes(2);
    expect(harness.current.status).toBe("active");
  });

  it("durante una renovación silenciosa sigue mostrando el QR vigente", async () => {
    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });
    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });
    const firstPayload = harness.current.qrPayload;

    // La generación siguiente queda colgada (red lenta).
    mockGenerateHandshake.mockReturnValueOnce(new Promise(() => {}));

    await act(async () => {
      jest.advanceTimersByTime(12000);
    });

    expect(mockGenerateHandshake).toHaveBeenCalledTimes(2);
    expect(harness.current.status).toBe("active");
    expect(harness.current.qrPayload).toBe(firstPayload);
  });

  it("si la renovación falla, saca el QR y pide un reintento manual", async () => {
    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });
    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    mockGenerateHandshake.mockRejectedValueOnce(
      new ApiError(422, "HANDSHAKE_DISTANCE_EXCEEDED", "Distance exceeded")
    );

    await act(async () => {
      jest.advanceTimersByTime(12000);
    });

    await waitFor(() => {
      expect(harness.current.status).toBe("error");
    });
    expect(harness.current.qrPayload).toBeNull();
    expect(harness.current.error).toContain("100 m");

    // Sin reintento automático tras un error.
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(mockGenerateHandshake).toHaveBeenCalledTimes(2);

    await act(async () => {
      await harness.current.regenerate();
    });
    expect(harness.current.status).toBe("active");
    expect(harness.current.error).toBeNull();
  });

  it("deja de renovar al desmontar", async () => {
    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });
    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    await act(async () => {
      harness.unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });

    expect(mockGenerateHandshake).toHaveBeenCalledTimes(1);
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

  it("MOVO-199 AC7: con onEvidenceMissing, DELIVERY_EVIDENCE_MISSING lo invoca en vez de setear un error genérico", async () => {
    mockGenerateHandshake.mockRejectedValueOnce(
      new ApiError(422, "DELIVERY_EVIDENCE_MISSING", "Evidence missing")
    );
    const onEvidenceMissing = jest.fn();

    const harness = await renderHarness({ shipmentId, initialStage: "delivery", onEvidenceMissing });

    await waitFor(() => {
      expect(onEvidenceMissing).toHaveBeenCalledTimes(1);
    });

    expect(harness.current.status).not.toBe("error");
    expect(harness.current.error).toBeNull();
  });

  it("MOVO-199 AC7: PICKUP_EVIDENCE_MISSING también dispara onEvidenceMissing (mismo mecanismo compartido)", async () => {
    mockGenerateHandshake.mockRejectedValueOnce(
      new ApiError(422, "PICKUP_EVIDENCE_MISSING", "Evidence missing")
    );
    const onEvidenceMissing = jest.fn();

    await renderHarness({ shipmentId, initialStage: "pickup", onEvidenceMissing });

    await waitFor(() => {
      expect(onEvidenceMissing).toHaveBeenCalledTimes(1);
    });
  });

  it("sin onEvidenceMissing, DELIVERY_EVIDENCE_MISSING cae al error genérico (retrocompatible con /handshake y /dev-handshake)", async () => {
    mockGenerateHandshake.mockRejectedValueOnce(
      new ApiError(422, "DELIVERY_EVIDENCE_MISSING", "Evidence missing")
    );

    const harness = await renderHarness({ shipmentId, initialStage: "delivery" });

    await waitFor(() => {
      expect(harness.current.status).toBe("error");
    });
    expect(harness.current.error).not.toBeNull();
  });

  it("ancla la renovación al expiresAt autoritativo del backend (latencia de red)", async () => {
    // El backend devolvió un expiresAt con solo 10s restantes respecto de Date.now().
    mockGenerateHandshake.mockResolvedValueOnce({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-latency",
      canonicalPayload: `${shipmentId}:pickup:nonce-latency`,
      expiresAt: "2026-09-19T10:00:10.000Z",
      ttlSeconds: 15,
    });

    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });
    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    await act(async () => {
      jest.advanceTimersByTime(6900);
    });
    expect(mockGenerateHandshake).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(mockGenerateHandshake).toHaveBeenCalledTimes(2);
  });

  it("renueva enseguida si el expiresAt del backend ya venció en tránsito", async () => {
    mockGenerateHandshake.mockResolvedValueOnce({
      shipmentId,
      stage: "pickup",
      nonce: "nonce-expired-backend",
      canonicalPayload: `${shipmentId}:pickup:nonce-expired-backend`,
      expiresAt: "2026-09-19T09:59:59.000Z",
      ttlSeconds: 15,
    });

    const harness = await renderHarness({ shipmentId, initialStage: "pickup" });
    await waitFor(() => {
      expect(harness.current.status).toBe("active");
    });

    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    await waitFor(() => {
      expect(JSON.parse(harness.current.qrPayload!).nonce).toBe("nonce-xyz-456");
    });
  });

  it("usa Date.now() + ttl como fallback si expiresAt no es válido", async () => {
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

    await act(async () => {
      jest.advanceTimersByTime(8900);
    });
    expect(mockGenerateHandshake).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(mockGenerateHandshake).toHaveBeenCalledTimes(2);
  });
});
