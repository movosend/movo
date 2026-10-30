import { AppState } from "react-native";
import { create } from "zustand";
import type { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import { authClient } from "../api/auth-client";
import { isRefreshRejected, registerAuthHooks } from "../api/http-client";
import type { SessionResponse } from "../api/session-types";
import {
  SECURE_STORE_KEYS,
  deletePendingRegistrationKeys,
  migrateKeychainAccess,
  secureStore,
} from "../lib/secure-store";
import { unregisterCurrentDevice } from "../lib/push-registration";

export interface SessionUser {
  userId: string;
  fullName: string;
  roles: UserRole[];
  kycStatus: KycStatus;
}

export type SessionStatus = "checking" | "authenticated" | "unauthenticated";

/** MOVO-300: por qué se cerró la sesión sin que el usuario la cerrara, para mostrarle la
 * pantalla que corresponde en vez de mandarlo al login sin explicación. */
export type SignOutReason = "account_disabled";

/** Margen antes del vencimiento real para disparar un refresh proactivo en
 * `restoreSession()` — evita el caso límite de considerar "vigente" un token que
 * vence en el segundo que toma restaurar la sesión y renderizar la primera pantalla. */
const REFRESH_MARGIN_MS = 30_000;

interface AuthState {
  status: SessionStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  /** Lo lee el guard de `app/(app)/_layout.tsx`; lo limpia la pantalla que lo muestra. */
  signOutReason: SignOutReason | null;

  /** Se llama una sola vez desde `app/_layout.tsx` al bootear la app (AC7/AC8). */
  restoreSession: () => Promise<void>;
  /** Persiste + activa una sesión nueva (login, register, refresh). */
  setSession: (session: SessionResponse) => Promise<void>;
  /** Actualiza el estado de KYC del usuario en memoria y en secure-store. */
  updateKycStatus: (kycStatus: KycStatus) => Promise<void>;
  /** Actualiza el nombre mostrado del usuario en memoria y en secure-store
   * (MOVO-135: el perfil pasó a ser editable, `fullName` ya no es inmutable). */
  updateFullName: (fullName: string) => Promise<void>;
  /** Limpia sesión local (secure-store + estado) sin llamar al backend — usado tanto
   * por un refresh fallido (AC6) como internamente por `logout()`. */
  clearSession: () => Promise<void>;
  /** AC10: llama al endpoint de logout y limpia la sesión local. */
  logout: () => Promise<void>;
  /** MOVO-300 AC4: el gateway respondió `ACCOUNT_DISABLED` con la sesión abierta. */
  signOutDisabledAccount: () => Promise<void>;
  /** El motivo ya se mostró (se muestra una sola vez). */
  clearSignOutReason: () => void;
}

function toSessionUser(session: SessionResponse): SessionUser {
  return {
    userId: session.userId,
    fullName: session.fullName,
    roles: session.roles,
    kycStatus: session.kycStatus,
  };
}

async function persistSession(session: SessionResponse): Promise<void> {
  const expiresAt = Date.now() + session.expiresIn * 1000;
  await Promise.all([
    secureStore.setItem(SECURE_STORE_KEYS.sessionAccessToken, session.accessToken),
    secureStore.setItem(SECURE_STORE_KEYS.sessionRefreshToken, session.refreshToken),
    secureStore.setItem(SECURE_STORE_KEYS.sessionUser, JSON.stringify(toSessionUser(session))),
    secureStore.setItem(SECURE_STORE_KEYS.sessionExpiresAt, String(expiresAt)),
  ]);
}

const SESSION_KEYS = [
  SECURE_STORE_KEYS.sessionAccessToken,
  SECURE_STORE_KEYS.sessionRefreshToken,
  SECURE_STORE_KEYS.sessionUser,
  SECURE_STORE_KEYS.sessionExpiresAt,
] as const;

/** Sesión que `setSession` no pudo persistir: se reintenta al volver la app a `active`. */
let pendingPersist: SessionResponse | null = null;

async function retryPendingPersist(): Promise<void> {
  const session = pendingPersist;
  if (!session) return;
  try {
    await persistSession(session);
    // Si entretanto llegó otra sesión (o se cerró), esa manda.
    if (pendingPersist === session) pendingPersist = null;
  } catch {
    // Sigue pendiente para la próxima vuelta a primer plano.
  }
}

async function clearPersistedSession(): Promise<void> {
  await Promise.all([
    secureStore.deleteItem(SECURE_STORE_KEYS.sessionAccessToken),
    secureStore.deleteItem(SECURE_STORE_KEYS.sessionRefreshToken),
    secureStore.deleteItem(SECURE_STORE_KEYS.sessionUser),
    secureStore.deleteItem(SECURE_STORE_KEYS.sessionExpiresAt),
    deletePendingRegistrationKeys(secureStore),
  ]);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "checking",
  accessToken: null,
  refreshToken: null,
  user: null,
  signOutReason: null,

  async setSession(session) {
    // MOVO-346 (punto 1): memoria primero. Un refresh ya rotó el token en el servidor, así que
    // si persistirlo falla (Keychain sin acceso con el teléfono bloqueado) la sesión nueva tiene
    // que seguir viva en memoria: tirarla la perdía seguro. Se reintenta al volver a `active`.
    set({
      status: "authenticated",
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: toSessionUser(session),
      signOutReason: null,
    });
    try {
      await persistSession(session);
      pendingPersist = null;
    } catch {
      pendingPersist = session;
    }
  },

  async updateKycStatus(kycStatus: KycStatus) {
    const currentUser = get().user;
    if (!currentUser) return;
    const updatedUser: SessionUser = { ...currentUser, kycStatus };
    await secureStore.setItem(SECURE_STORE_KEYS.sessionUser, JSON.stringify(updatedUser));
    set({ user: updatedUser });
  },

  async updateFullName(fullName: string) {
    const currentUser = get().user;
    if (!currentUser || currentUser.fullName === fullName) return;
    const updatedUser: SessionUser = { ...currentUser, fullName };
    await secureStore.setItem(SECURE_STORE_KEYS.sessionUser, JSON.stringify(updatedUser));
    set({ user: updatedUser });
  },

  async clearSession() {
    pendingPersist = null;
    await clearPersistedSession();
    set({ status: "unauthenticated", accessToken: null, refreshToken: null, user: null });
  },

  async restoreSession() {
    try {
      await migrateKeychainAccess(SESSION_KEYS);
    } catch {
      // Best-effort: sin migrar, el próximo refresh con el teléfono bloqueado puede no persistir,
      // pero ya no cierra la sesión (`setSession`). Se reintenta en el próximo arranque.
    }
    const [accessToken, refreshToken, userJson, expiresAtRaw] = await Promise.all([
      secureStore.getItem(SECURE_STORE_KEYS.sessionAccessToken),
      secureStore.getItem(SECURE_STORE_KEYS.sessionRefreshToken),
      secureStore.getItem(SECURE_STORE_KEYS.sessionUser),
      secureStore.getItem(SECURE_STORE_KEYS.sessionExpiresAt),
    ]);

    if (!accessToken || !refreshToken || !userJson || !expiresAtRaw) {
      set({ status: "unauthenticated" });
      return;
    }

    const expiresAt = Number(expiresAtRaw);
    const expiredOrExpiringSoon = Number.isNaN(expiresAt) || Date.now() >= expiresAt - REFRESH_MARGIN_MS;

    if (!expiredOrExpiringSoon) {
      try {
        const user = JSON.parse(userJson) as SessionUser;
        set({ status: "authenticated", accessToken, refreshToken, user });
      } catch {
        // sessionUser corrupto en secure-store (escritura interrumpida, etc.) — no
        // se puede confiar en el resto de la sesión persistida, se limpia y arranca
        // sin sesión en vez de dejar restoreSession() colgado en una excepción no
        // capturada durante el boot (app/_layout.tsx queda en "checking" para siempre).
        await get().clearSession();
      }
      return;
    }

    // AC7: "si están vencidos, se intenta refresh silencioso antes de mostrar el
    // login" — proactivo acá, no se espera a que un 401 real del interceptor de
    // http-client.ts lo dispare, para no mostrar la app autenticada un instante y
    // caer a login después (el parpadeo que pide evitar AC8).
    let session: SessionResponse;
    try {
      session = await authClient.refresh({ refreshToken });
    } catch (err) {
      // Solo un rechazo del servidor cierra la sesión (`isRefreshRejected`). Sin red se arranca
      // con la sesión guardada: el primer 401 del interceptor vuelve a intentar el refresh.
      if (isRefreshRejected(err)) {
        await get().clearSession();
        return;
      }
      try {
        const user = JSON.parse(userJson) as SessionUser;
        set({ status: "authenticated", accessToken, refreshToken, user });
      } catch {
        await get().clearSession();
      }
      return;
    }
    await get().setSession(session);
  },

  async logout() {
    const { refreshToken, accessToken } = get();
    if (refreshToken && accessToken) {
      try {
        await authClient.logout(refreshToken, accessToken);
      } catch {
        // AC10, tolerado a propósito: un logout sin conexión no debe dejar al usuario
        // atrapado logueado — se limpia la sesión local de todas formas. La sesión en
        // el backend queda viva hasta que expire sola (90 días, ADR-013) o se detecte
        // reuso del refresh token en un intento posterior.
      }
    }
    // MOVO-107 AC4: con la sesión todavía viva (httpClient necesita el accessToken
    // para adjuntar `Authorization`) — `unregisterCurrentDevice()` ya tolera sus
    // propios fallos internamente, pero se envuelve igual en `try/catch` acá (mismo
    // criterio que `authClient.logout` arriba): un paso secundario nunca puede
    // bloquear salir de la cuenta, ni siquiera si ese contrato interno cambiara.
    try {
      await unregisterCurrentDevice();
    } catch {
      // Tolerado a propósito, ver comentario de arriba.
    }
    await get().clearSession();
  },

  async signOutDisabledAccount() {
    // Sin sesión no hay nada que cerrar: el login de una cuenta inhabilitada también responde
    // `ACCOUNT_DISABLED`, y ese caso lo maneja `login.tsx` con su propia navegación. Durante
    // `restoreSession()` (status "checking") sí aplica: el refresh de una cuenta inhabilitada
    // entra por acá.
    if (get().status === "unauthenticated") return;
    // A diferencia de `logout()`, no se desregistra el dispositivo ni se llama al logout del
    // backend: con la cuenta inhabilitada el gateway rechaza esos requests (y el 403 volvería a
    // entrar acá), y `svc-users` ya revocó todas las sesiones al inhabilitar.
    set({ signOutReason: "account_disabled" });
    await get().clearSession();
  },

  clearSignOutReason() {
    set({ signOutReason: null });
  },
}));

// Conecta la capa de red (http-client.ts) con este store sin que http-client.ts
// tenga que importar Zustand — se registra una sola vez al cargar este módulo.
registerAuthHooks({
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: (session) => useAuthStore.getState().setSession(session),
  onAuthFailure: () => useAuthStore.getState().clearSession(),
  onAccountDisabled: () => useAuthStore.getState().signOutDisabledAccount(),
});

AppState.addEventListener("change", (state) => {
  if (state === "active") void retryPendingPersist();
});
