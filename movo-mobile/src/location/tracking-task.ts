import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { shipmentsClient, BatchPositionItemInput, BatchPositionResultItem } from "../api/shipments-client";
import { offlineQueueStorage, QueuedPosition } from "./offline-queue-storage";
import { ApiError } from "@movo/shared/dist/errors/api-error";

export const MOVO_CARRIER_BACKGROUND_TRACKING_TASK = "movo-carrier-background-tracking";

export const BACKGROUND_TRACKING_INTERVAL_MS = 45_000;
export const BACKGROUND_DISTANCE_INTERVAL_METERS = 30;
export const MAX_POSITIONS_PER_BATCH = 100;

export interface TrackingContextData {
  tripId: string | null;
  shipmentIds: string[];
}

export type ShipmentDroppedListener = (shipmentId: string, reason: string) => void;

class BackgroundTrackingManager {
  private activeTripId: string | null = null;
  private activeShipmentIds = new Set<string>();
  private droppedListeners = new Set<ShipmentDroppedListener>();
  private isFlushing = false;
  private last429Timestamp = 0;
  private backoffDelayMs = 2_000;

  getTrackingContext(): TrackingContextData {
    return {
      tripId: this.activeTripId,
      shipmentIds: Array.from(this.activeShipmentIds),
    };
  }

  setTrackingContext(tripId: string | null, shipmentIds: string[]): void {
    this.activeTripId = tripId;
    this.activeShipmentIds = new Set(
      shipmentIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    );
  }

  removeShipment(shipmentId: string, reason = "SHIPMENT_NOT_TRACKABLE"): void {
    if (this.activeShipmentIds.has(shipmentId)) {
      this.activeShipmentIds.delete(shipmentId);
      for (const listener of this.droppedListeners) {
        try {
          listener(shipmentId, reason);
        } catch {
          // Ignorar errores de listeners
        }
      }
    }
  }

  onShipmentDropped(listener: ShipmentDroppedListener): () => void {
    this.droppedListeners.add(listener);
    return () => {
      this.droppedListeners.delete(listener);
    };
  }

  /**
   * Procesa las ubicaciones recibidas desde el sistema operativo en segundo plano.
   */
  async handleLocations(locations: Location.LocationObject[]): Promise<void> {
    if (!locations || locations.length === 0 || this.activeShipmentIds.size === 0) {
      return;
    }

    const newPositions: QueuedPosition[] = [];
    for (const loc of locations) {
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      const accuracyM = loc.coords.accuracy ?? 0;
      const capturedAt = new Date(loc.timestamp).toISOString();

      for (const shipmentId of this.activeShipmentIds) {
        newPositions.push({
          shipmentId,
          lat,
          lng,
          accuracyM,
          capturedAt,
        });
      }
    }

    if (newPositions.length > 0) {
      await offlineQueueStorage.enqueuePositions(newPositions);
    }

    // Intentar vaciar la cola en lote
    await this.flushBatchQueue();
  }

  /**
   * Vacía la cola usando el endpoint de lote POST /shipments/positions (AC8).
   * Respetando el rate limit (30 req/min de MOVO-250) con backoff exponencial ante 429.
   */
  async flushBatchQueue(): Promise<{ sentCount: number; remainingCount: number }> {
    if (this.isFlushing) {
      return { sentCount: 0, remainingCount: 0 };
    }

    // Verificar si estamos dentro del período de backoff por 429 reciente
    const now = Date.now();
    if (this.last429Timestamp > 0 && now - this.last429Timestamp < this.backoffDelayMs) {
      const q = await offlineQueueStorage.loadQueue();
      return { sentCount: 0, remainingCount: q.length };
    }

    this.isFlushing = true;
    try {
      const queue = await offlineQueueStorage.loadQueue();
      if (queue.length === 0) {
        return { sentCount: 0, remainingCount: 0 };
      }

      // Tomar hasta 100 posiciones por tanda (AC8 / MOVO-250)
      const batch = queue.slice(0, MAX_POSITIONS_PER_BATCH);
      const batchInput: BatchPositionItemInput[] = batch.map((item) => ({
        shipmentId: item.shipmentId,
        lat: item.lat,
        lng: item.lng,
        accuracyM: item.accuracyM,
        capturedAt: item.capturedAt,
      }));

      try {
        const response = await shipmentsClient.reportPositionsBatch(batchInput);
        this.last429Timestamp = 0;
        this.backoffDelayMs = 2_000;

        // Procesar resultados por ítem
        const resultsMap = new Map<number, BatchPositionResultItem>();
        for (const res of response.results ?? []) {
          resultsMap.set(res.index, res);
        }

        const indicesToRemove = new Set<number>();

        for (let i = 0; i < batch.length; i++) {
          const res = resultsMap.get(i);
          if (!res) {
            // Si el backend no devolvió status para este índice, asumimos removible solo si la request general fue 200
            indicesToRemove.add(i);
            continue;
          }

          if (res.status === "accepted") {
            indicesToRemove.add(i);
          } else if (res.status === "rejected") {
            // Errores terminales definitivos: descartar de la cola
            indicesToRemove.add(i);

            // Si el envío ya no es trackeable en el viaje (MOVO-251 / AC7), dejar de trackearlo
            if (res.code === "SHIPMENT_NOT_TRACKABLE") {
              this.removeShipment(res.shipmentId, "SHIPMENT_NOT_TRACKABLE");
            }
          }
        }

        // Reconstruir la cola con los ítems no removidos del batch + el resto de la cola
        const remainingBatch = batch.filter((_, idx) => !indicesToRemove.has(idx));
        const restOfQueue = queue.slice(MAX_POSITIONS_PER_BATCH);
        const newQueue = [...remainingBatch, ...restOfQueue];
        await offlineQueueStorage.saveQueue(newQueue);

        const sent = batch.length - remainingBatch.length;
        return { sentCount: sent, remainingCount: newQueue.length };
      } catch (err: unknown) {
        if (err instanceof ApiError && err.statusCode === 429) {
          this.last429Timestamp = Date.now();
          this.backoffDelayMs = Math.min(this.backoffDelayMs * 2, 60_000);
        }
        // Ante fallas de red, 429 o 5xx, no descartamos posiciones (AC10)
        return { sentCount: 0, remainingCount: queue.length };
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Inicia el tracking de ubicación en segundo plano con expo-location y expo-task-manager.
   */
  async startBackgroundTracking(tripId: string, shipmentIds: string[]): Promise<boolean> {
    this.setTrackingContext(tripId, shipmentIds);

    const hasForeground = await Location.getForegroundPermissionsAsync();
    if (!hasForeground.granted) {
      return false;
    }

    const hasBackground = await Location.getBackgroundPermissionsAsync();
    if (!hasBackground.granted) {
      return false;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(MOVO_CARRIER_BACKGROUND_TRACKING_TASK);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(MOVO_CARRIER_BACKGROUND_TRACKING_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: BACKGROUND_TRACKING_INTERVAL_MS,
        distanceInterval: BACKGROUND_DISTANCE_INTERVAL_METERS,
        deferredUpdatesInterval: BACKGROUND_TRACKING_INTERVAL_MS,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Movo en viaje",
          notificationBody: "Compartiendo ubicación del viaje en tiempo real",
          notificationColor: "#C3F53C",
        },
      });
    }

    return true;
  }

  /**
   * Detiene y desregistra el tracking de fondo de inmediato (AC5, AC6, AC11).
   */
  async stopBackgroundTracking(): Promise<void> {
    this.activeTripId = null;
    this.activeShipmentIds.clear();

    const isRegistered = await TaskManager.isTaskRegisteredAsync(MOVO_CARRIER_BACKGROUND_TRACKING_TASK);
    if (isRegistered) {
      try {
        await Location.stopLocationUpdatesAsync(MOVO_CARRIER_BACKGROUND_TRACKING_TASK);
      } catch {
        // Ignorar error si ya estaba detenida
      }
    }

    // Intentar un último vaciado de la cola remanente al frenar
    await this.flushBatchQueue();
  }

  async isBackgroundTrackingActive(): Promise<boolean> {
    return TaskManager.isTaskRegisteredAsync(MOVO_CARRIER_BACKGROUND_TRACKING_TASK);
  }
}

export const backgroundTrackingManager = new BackgroundTrackingManager();

// Definición de la tarea en segundo plano con TaskManager a nivel de módulo
TaskManager.defineTask(
  MOVO_CARRIER_BACKGROUND_TRACKING_TASK,
  async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations?: Location.LocationObject[] }>) => {
    if (error) {
      return;
    }
    if (data?.locations) {
      await backgroundTrackingManager.handleLocations(data.locations);
    }
  }
);
