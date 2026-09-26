import * as Location from "expo-location";
import { shipmentsClient, BatchPositionItemInput } from "../api/shipments-client";
import { TripStatus } from "../api/trips-client";
import { offlineQueueStorage, QueuedPosition, OfflineQueueStorage } from "./offline-queue-storage";
import { backgroundTrackingManager } from "./tracking-task";
import { ApiError } from "@movo/shared/dist/errors/api-error";

export type { QueuedPosition };

export interface TrackingStatus {
  isTracking: boolean;
  tripId: string | null;
  activeShipmentIds: string[];
  pendingQueueCount: number;
  permissionGranted: boolean | null; // Foreground permission (compatibilidad)
  foregroundPermissionGranted: boolean | null;
  backgroundPermissionGranted: boolean | null;
  isForegroundOnly: boolean;
  isBackgroundActive: boolean;
  lastCapturedAt: string | null;
  lastReportedAt: string | null;
  lastError: string | null;
}

export interface LocationServiceOptions {
  /** Intervalo en milisegundos entre reportes en primer plano (~20 a 30s según AC2 de MOVO-203). */
  intervalMs?: number;
  /** Límite defensivo de posiciones encoladas offline para evitar saturación de memoria. */
  maxQueueSize?: number;
}

export interface LocationServiceDeps {
  location: {
    getForegroundPermissionsAsync: () => Promise<Location.PermissionResponse>;
    requestForegroundPermissionsAsync?: () => Promise<Location.PermissionResponse>;
    getBackgroundPermissionsAsync?: () => Promise<Location.PermissionResponse>;
    requestBackgroundPermissionsAsync?: () => Promise<Location.PermissionResponse>;
    getCurrentPositionAsync: (options?: Location.LocationOptions) => Promise<Location.LocationObject>;
  };
  client: {
    reportPosition: (
      shipmentId: string,
      input: { lat: number; lng: number; accuracyM: number; capturedAt: string }
    ) => Promise<{ persisted: boolean }>;
    reportPositionsBatch?: (
      positions: BatchPositionItemInput[]
    ) => Promise<{ results: Array<{ index: number; shipmentId: string; status: "accepted" | "rejected"; persisted?: boolean; code?: string }> }>;
  };
  storage: {
    loadQueue: () => Promise<QueuedPosition[]>;
    saveQueue: (queue: QueuedPosition[]) => Promise<void>;
    enqueuePositions: (positions: QueuedPosition[]) => Promise<QueuedPosition[]>;
    clearQueue: () => Promise<void>;
  };
  options?: LocationServiceOptions;
}

const DEFAULT_INTERVAL_MS = 25_000;
const DEFAULT_MAX_QUEUE_SIZE = 100;

export class LocationService {
  private activeTripId: string | null = null;
  private activeShipmentIds = new Set<string>();
  private offlineQueue: QueuedPosition[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessingTick = false;
  private isProcessingFlush = false;
  private isTrackingState = false;
  private isSimulating = false;
  private foregroundGranted: boolean | null = null;
  private backgroundGranted: boolean | null = null;
  private isBackgroundActiveState = false;
  private lastCapturedAt: string | null = null;
  private lastReportedAt: string | null = null;
  private lastError: string | null = null;
  private listeners = new Set<(status: TrackingStatus) => void>();
  private backgroundDroppedUnsub: (() => void) | null = null;

  private readonly location: LocationServiceDeps["location"];
  private readonly client: LocationServiceDeps["client"];
  private readonly storage: LocationServiceDeps["storage"];
  private readonly intervalMs: number;
  private readonly maxQueueSize: number;

  constructor(deps?: Partial<LocationServiceDeps>) {
    this.location = deps?.location ?? Location;
    this.client = deps?.client ?? shipmentsClient;
    this.storage = deps?.storage ?? offlineQueueStorage;
    this.intervalMs = deps?.options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxQueueSize = deps?.options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

    // Escuchar cuando el background task descarte un envío por SHIPMENT_NOT_TRACKABLE (MOVO-251 / AC7)
    this.backgroundDroppedUnsub = backgroundTrackingManager.onShipmentDropped((shipmentId) => {
      this.handleShipmentDropped(shipmentId);
    });
  }

  /**
   * Carga la cola offline persistida en storage de archivo al inicializar.
   */
  async loadPersistedQueue(): Promise<void> {
    try {
      const stored = await this.storage.loadQueue();
      this.offlineQueue = stored.slice(-this.maxQueueSize);
      this.emitStatus();
    } catch {
      this.offlineQueue = [];
    }
  }

  /**
   * Inicia el tracking periódico para un viaje y sus envíos asociados.
   * Soporta tanto el objeto `{ tripId, shipmentIds }` como el array `shipmentIds` por compatibilidad.
   */
  async startTracking(input: string[] | { tripId?: string | null; shipmentIds: string[] }): Promise<void> {
    const tripId = Array.isArray(input) ? null : input.tripId ?? null;
    const shipmentIds = Array.isArray(input) ? input : input.shipmentIds;
    const validIds = shipmentIds.filter((id) => typeof id === "string" && id.trim().length > 0);

    if (validIds.length === 0 && !tripId) {
      await this.stopTracking();
      return;
    }

    this.activeTripId = tripId;
    this.activeShipmentIds = new Set(validIds);

    // Sincronizar contexto con la tarea en segundo plano
    backgroundTrackingManager.setTrackingContext(this.activeTripId, validIds);

    if (!this.isTrackingState) {
      this.isTrackingState = true;
      await this.loadPersistedQueue();

      // Intentar arrancar background tracking si los permisos de background están dados
      await this.ensureBackgroundTracking();

      // Disparar captura inmediata en foreground si hay envíos activos y programar intervalo periódico
      if (this.activeShipmentIds.size > 0) {
        await this.captureAndReportTick();
      }
      this.timer = setInterval(() => {
        void this.captureAndReportTick();
      }, this.intervalMs);
    }

    this.emitStatus();
  }

  /**
   * Inicia background tracking si se cuenta con el permiso requerido.
   */
  private async ensureBackgroundTracking(): Promise<void> {
    if (!this.backgroundGranted) {
      await this.checkBackgroundPermission();
    }
    if (this.backgroundGranted && (this.activeShipmentIds.size > 0 || this.activeTripId) && !this.isSimulating) {
      try {
        const started = await backgroundTrackingManager.startBackgroundTracking(
          this.activeTripId ?? "trip-default",
          Array.from(this.activeShipmentIds)
        );
        this.isBackgroundActiveState = started;
      } catch {
        this.isBackgroundActiveState = false;
      }
    } else {
      this.isBackgroundActiveState = false;
    }
  }

  /**
   * Actualiza los envíos activos y el viaje asociado.
   * Si el viaje finaliza (completed o cancelled), o si no hay viaje ni envíos, detiene el tracking.
   */
  async updateActiveShipments(
    shipmentIds: string[],
    tripId?: string | null,
    tripStatus?: string | null
  ): Promise<void> {
    if (this.isSimulating) {
      return;
    }
    if (
      tripStatus === "completed" ||
      tripStatus === "cancelled" ||
      tripStatus === TripStatus.COMPLETED ||
      tripStatus === TripStatus.CANCELLED
    ) {
      this.activeTripId = null;
      this.activeShipmentIds.clear();
      await this.stopTracking();
      return;
    }

    const validIds = shipmentIds.filter((id) => typeof id === "string" && id.trim().length > 0);

    if (tripId !== undefined) {
      this.activeTripId = tripId;
    }

    // Si no hay envíos trackeables, frenar tracking
    if (validIds.length === 0) {
      await this.stopTracking();
      return;
    }

    // Si se especificó tripStatus y no es activo, frenar tracking
    if (tripStatus !== undefined && tripStatus !== "active" && tripStatus !== TripStatus.ACTIVE) {
      await this.stopTracking();
      return;
    }

    this.activeShipmentIds = new Set(validIds);
    backgroundTrackingManager.setTrackingContext(this.activeTripId, validIds);

    if (!this.isTrackingState) {
      await this.startTracking({ tripId: this.activeTripId, shipmentIds: validIds });
    } else {
      await this.ensureBackgroundTracking();
      this.emitStatus();
    }
  }

  private handleShipmentDropped(shipmentId: string): void {
    if (this.activeShipmentIds.has(shipmentId)) {
      this.activeShipmentIds.delete(shipmentId);
      backgroundTrackingManager.setTrackingContext(this.activeTripId, Array.from(this.activeShipmentIds));
      if (this.activeShipmentIds.size === 0) {
        void this.stopTracking();
      } else {
        this.emitStatus();
      }
    }
  }

  setSimulationMode(enabled: boolean): void {
    this.isSimulating = enabled;
  }

  isSimulationMode(): boolean {
    return this.isSimulating;
  }

  /**
   * Detiene el tracking inmediatamente, desregistra la tarea en segundo plano
   * y limpia el timer (AC5/AC6/AC7/AC11).
   */
  async stopTracking(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeTripId = null;
    this.activeShipmentIds.clear();
    this.isTrackingState = false;
    this.isSimulating = false;
    this.isBackgroundActiveState = false;
    this.lastError = null;

    // Detener la tarea en segundo plano de inmediato
    await backgroundTrackingManager.stopBackgroundTracking();

    if (this.offlineQueue.length > 0) {
      await this.flushQueue();
    }

    this.emitStatus();
  }

  /**
   * Determina si un error retornado por la API es terminal y permanente.
   * Errores 4xx (400, 401, 403, 404) indican datos o estado no apto.
   * 429 (Rate Limit) NO es terminal y debe reintentarse.
   */
  private isTerminalError(err: unknown): boolean {
    if (!(err instanceof ApiError)) {
      return false;
    }
    if (err.statusCode === 429) {
      return false;
    }
    return err.statusCode >= 400 && err.statusCode < 500;
  }

  /**
   * Ciclo individual de captura de posición GPS y reporte a backend en primer plano.
   */
  async captureAndReportTick(): Promise<void> {
    if (this.isProcessingTick || this.activeShipmentIds.size === 0) {
      return;
    }

    this.isProcessingTick = true;
    try {
      // 1. Verificar permiso de primer plano
      const permission = await this.location.getForegroundPermissionsAsync();
      this.foregroundGranted = permission.granted;
      if (!permission.granted) {
        this.lastError = "PERMISSION_DENIED";
        this.emitStatus();
        return;
      }
      if (this.lastError === "PERMISSION_DENIED") {
        this.lastError = null;
      }

      // 2. Obtener posición GPS actual
      const position = await this.location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const capturedAt = new Date(position.timestamp).toISOString();
      this.lastCapturedAt = capturedAt;
      this.lastError = null;

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracyM = position.coords.accuracy ?? 0;

      // 3. Encolar y reportar para cada envío activo
      const newPositions: QueuedPosition[] = [];
      for (const shipmentId of this.activeShipmentIds) {
        newPositions.push({
          shipmentId,
          lat,
          lng,
          accuracyM,
          capturedAt,
        });
      }

      await this.storage.enqueuePositions(newPositions);
      this.offlineQueue = await this.storage.loadQueue();

      // 4. Intentar vaciar la cola usando lote unificado
      await this.flushQueue();
      this.lastReportedAt = new Date().toISOString();
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : "LOCATION_UNAVAILABLE";
    } finally {
      this.isProcessingTick = false;
      this.emitStatus();
    }
  }

  /**
   * Agrega una posición a la cola offline persistida.
   */
  async enqueuePosition(item: QueuedPosition): Promise<void> {
    this.offlineQueue = await this.storage.enqueuePositions([item]);
    this.emitStatus();
  }

  /**
   * Limpia toda la cola offline de memoria y archivo.
   */
  async clearQueue(): Promise<void> {
    await this.storage.clearQueue();
    this.offlineQueue = [];
    this.emitStatus();
  }

  /**
   * Drena las posiciones encoladas en lotes de hasta 100 usando el endpoint de lote (AC8).
   * Protegido contra reentrancia.
   */
  async flushQueue(): Promise<void> {
    if (this.isProcessingFlush) return;

    this.isProcessingFlush = true;
    try {
      await backgroundTrackingManager.flushBatchQueue();
      this.offlineQueue = await this.storage.loadQueue();
    } finally {
      this.isProcessingFlush = false;
      this.emitStatus();
    }
  }

  /**
   * Consulta permisos de ubicación en primer plano.
   */
  async checkForegroundPermission(): Promise<boolean> {
    try {
      const perm = await this.location.getForegroundPermissionsAsync();
      this.foregroundGranted = perm.granted;
      if (!perm.granted) {
        this.lastError = "PERMISSION_DENIED";
      } else if (this.lastError === "PERMISSION_DENIED") {
        this.lastError = null;
      }
      this.emitStatus();
      return perm.granted;
    } catch {
      this.foregroundGranted = false;
      this.lastError = "PERMISSION_DENIED";
      this.emitStatus();
      return false;
    }
  }

  /**
   * Solicita permisos de ubicación en primer plano (Etapa 1).
   */
  async requestForegroundPermission(): Promise<boolean> {
    try {
      const requestFn =
        this.location.requestForegroundPermissionsAsync ??
        Location.requestForegroundPermissionsAsync;
      const perm = await requestFn();
      this.foregroundGranted = perm.granted;
      if (!perm.granted) {
        this.lastError = "PERMISSION_DENIED";
      } else if (this.lastError === "PERMISSION_DENIED") {
        this.lastError = null;
      }
      this.emitStatus();
      if (perm.granted && this.activeShipmentIds.size > 0 && this.isTrackingState) {
        void this.captureAndReportTick();
      }
      return perm.granted;
    } catch {
      this.foregroundGranted = false;
      this.lastError = "PERMISSION_DENIED";
      this.emitStatus();
      return false;
    }
  }

  /**
   * Consulta permisos de ubicación en segundo plano (Etapa 2).
   */
  async checkBackgroundPermission(): Promise<boolean> {
    try {
      const checkFn =
        this.location.getBackgroundPermissionsAsync ??
        Location.getBackgroundPermissionsAsync;
      const perm = await checkFn();
      this.backgroundGranted = perm.granted;
      this.emitStatus();
      return perm.granted;
    } catch {
      this.backgroundGranted = false;
      this.emitStatus();
      return false;
    }
  }

  /**
   * Solicita permisos de ubicación en segundo plano (Etapa 2).
   * Solo debe invocarse tras mostrar el modal/pantalla explicativa previa (AC2).
   */
  async requestBackgroundPermission(): Promise<boolean> {
    try {
      const requestFn =
        this.location.requestBackgroundPermissionsAsync ??
        Location.requestBackgroundPermissionsAsync;
      const perm = await requestFn();
      this.backgroundGranted = perm.granted;
      if (perm.granted) {
        await this.ensureBackgroundTracking();
      }
      this.emitStatus();
      return perm.granted;
    } catch {
      this.backgroundGranted = false;
      this.emitStatus();
      return false;
    }
  }

  /**
   * Consulta el estado de permisos de primer plano (compatibilidad hacia atrás).
   */
  async checkPermission(): Promise<boolean> {
    return this.checkForegroundPermission();
  }

  /**
   * Solicita permisos de ubicación (compatibilidad hacia atrás, solicita foreground).
   */
  async requestPermission(): Promise<boolean> {
    return this.requestForegroundPermission();
  }

  /**
   * Estado actual del servicio de tracking.
   */
  getStatus(): TrackingStatus {
    const isForegroundOnly =
      Boolean(this.foregroundGranted) && this.backgroundGranted !== true;

    return {
      isTracking: this.isTrackingState,
      tripId: this.activeTripId,
      activeShipmentIds: Array.from(this.activeShipmentIds),
      pendingQueueCount: this.offlineQueue.length,
      permissionGranted: this.foregroundGranted,
      foregroundPermissionGranted: this.foregroundGranted,
      backgroundPermissionGranted: this.backgroundGranted,
      isForegroundOnly,
      isBackgroundActive: this.isBackgroundActiveState,
      lastCapturedAt: this.lastCapturedAt,
      lastReportedAt: this.lastReportedAt,
      lastError: this.lastError,
    };
  }

  /**
   * Resetea el estado para pruebas unitarias.
   */
  async resetForTesting(): Promise<void> {
    await this.stopTracking();
    this.offlineQueue = [];
    this.foregroundGranted = null;
    this.backgroundGranted = null;
    this.isBackgroundActiveState = false;
    this.lastCapturedAt = null;
    this.lastReportedAt = null;
    this.lastError = null;
    this.emitStatus();
  }

  /**
   * Obtiene copia de la cola actual.
   */
  getQueue(): QueuedPosition[] {
    return [...this.offlineQueue];
  }

  /**
   * Suscripción a cambios de estado del servicio.
   */
  subscribe(listener: (status: TrackingStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // Ignorar excepciones de listeners
      }
    }
  }
}

export const locationService = new LocationService();
