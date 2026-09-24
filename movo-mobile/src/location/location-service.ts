import * as Location from "expo-location";
import { shipmentsClient } from "../api/shipments-client";
import { secureStore, SECURE_STORE_KEYS } from "../lib/secure-store";
import { ApiError } from "@movo/shared/dist/errors/api-error";

export interface QueuedPosition {
  shipmentId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string; // ISO-8601 string
}

export interface TrackingStatus {
  isTracking: boolean;
  activeShipmentIds: string[];
  pendingQueueCount: number;
  permissionGranted: boolean | null;
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
    getCurrentPositionAsync: (options?: Location.LocationOptions) => Promise<Location.LocationObject>;
  };
  client: {
    reportPosition: (
      shipmentId: string,
      input: { lat: number; lng: number; accuracyM: number; capturedAt: string }
    ) => Promise<{ persisted: boolean }>;
  };
  storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    deleteItem: (key: string) => Promise<void>;
  };
  options?: LocationServiceOptions;
}

const DEFAULT_INTERVAL_MS = 25_000;
const DEFAULT_MAX_QUEUE_SIZE = 100;

export class LocationService {
  private activeShipmentIds = new Set<string>();
  private offlineQueue: QueuedPosition[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessingTick = false;
  private isProcessingFlush = false;
  private isTrackingState = false;
  private isSimulating = false;
  private permissionGranted: boolean | null = null;
  private lastCapturedAt: string | null = null;
  private lastReportedAt: string | null = null;
  private lastError: string | null = null;
  private listeners = new Set<(status: TrackingStatus) => void>();

  private readonly location: LocationServiceDeps["location"];
  private readonly client: LocationServiceDeps["client"];
  private readonly storage: LocationServiceDeps["storage"];
  private readonly intervalMs: number;
  private readonly maxQueueSize: number;

  constructor(deps?: Partial<LocationServiceDeps>) {
    this.location = deps?.location ?? Location;
    this.client = deps?.client ?? shipmentsClient;
    this.storage = deps?.storage ?? secureStore;
    this.intervalMs = deps?.options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxQueueSize = deps?.options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  /**
   * Carga la cola offline persistida en storage al inicializar.
   */
  async loadPersistedQueue(): Promise<void> {
    try {
      const raw = await this.storage.getItem(SECURE_STORE_KEYS.carrierLocationOfflineQueue);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.offlineQueue = parsed.slice(-this.maxQueueSize);
          this.emitStatus();
        }
      }
    } catch {
      this.offlineQueue = [];
    }
  }

  /**
   * Guarda la cola offline actual en storage.
   */
  private async persistQueue(): Promise<void> {
    try {
      if (this.offlineQueue.length === 0) {
        await this.storage.deleteItem(SECURE_STORE_KEYS.carrierLocationOfflineQueue);
      } else {
        await this.storage.setItem(
          SECURE_STORE_KEYS.carrierLocationOfflineQueue,
          JSON.stringify(this.offlineQueue)
        );
      }
    } catch {
      // Manejo silencioso ante errores de persistencia
    }
  }

  /**
   * Inicia el tracking periódico para uno o más envíos activos en `in_transit`.
   */
  async startTracking(shipmentIds: string[]): Promise<void> {
    const validIds = shipmentIds.filter((id) => typeof id === "string" && id.trim().length > 0);
    if (validIds.length === 0) {
      await this.stopTracking();
      return;
    }

    this.activeShipmentIds = new Set(validIds);

    if (!this.isTrackingState) {
      this.isTrackingState = true;
      await this.loadPersistedQueue();
      // Disparar captura inmediata y programar intervalo periódico
      await this.captureAndReportTick();
      this.timer = setInterval(() => {
        void this.captureAndReportTick();
      }, this.intervalMs);
    }

    this.emitStatus();
  }

  /**
   * Actualiza el listado de envíos activos. Si la lista queda vacía, detiene el tracking de inmediato.
   */
  async updateActiveShipments(shipmentIds: string[]): Promise<void> {
    if (this.isSimulating) {
      // En modo simulación dev, no interrumpir el tracking simulado por el poll de envíos reales vacíos
      return;
    }
    const validIds = shipmentIds.filter((id) => typeof id === "string" && id.trim().length > 0);
    if (validIds.length === 0) {
      await this.stopTracking();
    } else {
      this.activeShipmentIds = new Set(validIds);
      if (!this.isTrackingState) {
        await this.startTracking(validIds);
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
   * Detiene el tracking inmediatamente y limpia el timer (AC5/AC6/AC7).
   * Si quedan posiciones encoladas en offlineQueue, intenta un último drenado.
   */
  async stopTracking(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeShipmentIds.clear();
    this.isTrackingState = false;
    this.isSimulating = false;
    this.lastError = null;

    if (this.offlineQueue.length > 0) {
      await this.flushQueue();
    }

    this.emitStatus();
  }

  /**
   * Determina si un error retornado por la API es terminal y permanente (no debe reintentarse).
   * Errores 4xx (400, 401, 403, 404) indican datos o estado no apto (ej: SHIPMENT_NOT_IN_TRANSIT).
   * Se excluye explícitamente 429 (Rate Limit / Too Many Requests), que es transitorio y debe reintentarse.
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
   * Ciclo individual de captura de posición GPS y reporte a backend.
   */
  async captureAndReportTick(): Promise<void> {
    if (this.isProcessingTick || this.activeShipmentIds.size === 0) {
      return;
    }

    this.isProcessingTick = true;
    try {
      // 1. Verificar permisos
      const permission = await this.location.getForegroundPermissionsAsync();
      this.permissionGranted = permission.granted;
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

      // 3. Reportar para cada envío activo
      for (const shipmentId of this.activeShipmentIds) {
        try {
          await this.client.reportPosition(shipmentId, {
            lat,
            lng,
            accuracyM,
            capturedAt,
          });
          this.lastReportedAt = new Date().toISOString();
        } catch (err) {
          if (!this.isTerminalError(err)) {
            // Error de conectividad, 429 (rate limit) o 5xx: encolar posición para reintento preservando capturedAt (AC6)
            this.enqueuePosition({
              shipmentId,
              lat,
              lng,
              accuracyM,
              capturedAt,
            });
          }
        }
      }

      // 4. Si hay elementos en la cola offline y el último reporte fue exitoso, intentar drenarla
      if (this.offlineQueue.length > 0 && this.lastReportedAt) {
        await this.flushQueue();
      }
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : "LOCATION_UNAVAILABLE";
    } finally {
      this.isProcessingTick = false;
      this.emitStatus();
    }
  }

  /**
   * Agrega una posición a la cola offline, respetando el tamaño máximo.
   */
  enqueuePosition(item: QueuedPosition): void {
    this.offlineQueue.push(item);
    if (this.offlineQueue.length > this.maxQueueSize) {
      this.offlineQueue.shift(); // Descartar la muestra más antigua
    }
    void this.persistQueue();
  }

  /**
   * Limpia toda la cola offline de memoria y storage.
   */
  async clearQueue(): Promise<void> {
    this.offlineQueue = [];
    await this.persistQueue();
    this.emitStatus();
  }

  /**
   * Drena secuencialmente las posiciones encoladas manteniendo el capturedAt original (AC6).
   * Protegido contra reentrancia para evitar concurrencia entre ticks y llamadas manuales.
   */
  async flushQueue(): Promise<void> {
    if (this.isProcessingFlush || this.offlineQueue.length === 0) return;

    this.isProcessingFlush = true;
    try {
      const remainingQueue: QueuedPosition[] = [];

      for (let i = 0; i < this.offlineQueue.length; i++) {
        const item = this.offlineQueue[i];
        try {
          await this.client.reportPosition(item.shipmentId, {
            lat: item.lat,
            lng: item.lng,
            accuracyM: item.accuracyM,
            capturedAt: item.capturedAt,
          });
        } catch (err) {
          if (this.isTerminalError(err)) {
            // Descartar este ítem ya que el envío nunca será aceptado por backend (ej. 403 no in_transit, 404)
            continue;
          }

          // Si falló por red, 429 (rate-limit) o 5xx, conservamos este ítem y el resto de la cola sin procesar
          remainingQueue.push(...this.offlineQueue.slice(i));
          break;
        }
      }

      this.offlineQueue = remainingQueue;
      await this.persistQueue();
    } finally {
      this.isProcessingFlush = false;
      this.emitStatus();
    }
  }

  /**
   * Consulta el estado actual de permisos de ubicación en primer plano y sincroniza el estado compartido.
   */
  async checkPermission(): Promise<boolean> {
    try {
      const perm = await this.location.getForegroundPermissionsAsync();
      this.permissionGranted = perm.granted;
      if (!perm.granted) {
        this.lastError = "PERMISSION_DENIED";
      } else if (this.lastError === "PERMISSION_DENIED") {
        this.lastError = null;
      }
      this.emitStatus();
      return perm.granted;
    } catch {
      this.permissionGranted = false;
      this.lastError = "PERMISSION_DENIED";
      this.emitStatus();
      return false;
    }
  }

  /**
   * Solicita permisos de ubicación en primer plano al usuario y sincroniza el estado compartido.
   */
  async requestPermission(): Promise<boolean> {
    try {
      const requestFn =
        this.location.requestForegroundPermissionsAsync ??
        Location.requestForegroundPermissionsAsync;
      const perm = await requestFn();
      this.permissionGranted = perm.granted;
      if (!perm.granted) {
        this.lastError = "PERMISSION_DENIED";
      } else if (this.lastError === "PERMISSION_DENIED") {
        this.lastError = null;
      }
      this.emitStatus();
      // Si se acaba de otorgar el permiso y hay envíos activos, intentar un reporte inmediato
      if (perm.granted && this.activeShipmentIds.size > 0 && this.isTrackingState) {
        void this.captureAndReportTick();
      }
      return perm.granted;
    } catch {
      this.permissionGranted = false;
      this.lastError = "PERMISSION_DENIED";
      this.emitStatus();
      return false;
    }
  }

  /**
   * Estado actual del servicio de tracking.
   */
  getStatus(): TrackingStatus {
    return {
      isTracking: this.isTrackingState,
      activeShipmentIds: Array.from(this.activeShipmentIds),
      pendingQueueCount: this.offlineQueue.length,
      permissionGranted: this.permissionGranted,
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
    this.permissionGranted = null;
    this.lastCapturedAt = null;
    this.lastReportedAt = null;
    this.lastError = null;
    this.emitStatus();
  }

  /**
   * Obtiene copia de la cola actual (útil para tests).
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
