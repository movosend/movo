import { KycStatus } from "@movo/shared/dist/types/user";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authClient } from "../api/auth-client";
import { friendlyErrorMessage } from "../lib/error-messages";
import { isPasswordValid } from "../lib/password-policy";
import { SECURE_STORE_KEYS, deletePendingRegistrationKeys, secureStore } from "../lib/secure-store";
import { useAuthStore } from "../store/auth-store";

export const PROVINCES = [
  "Buenos Aires",
  "CABA",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];

export interface RegistrationFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dni: string;
  street: string;
  number: string;
  floor: string;
  city: string;
  province: string;
  zip: string;
  password: string;
  passwordConfirm: string;
}

const EMPTY_FIELDS: RegistrationFields = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dni: "",
  street: "",
  number: "",
  floor: "",
  city: "",
  province: "",
  zip: "",
  password: "",
  passwordConfirm: "",
};

export type FieldName = keyof RegistrationFields;

export function isEmailValid(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function isPhoneValid(v: string): boolean {
  const s = v.replace(/[\s-]/g, "");
  return /^(\+?54)?9?\d{10}$/.test(s);
}

export function formatPhone(v: string): string {
  let d = v.replace(/\D/g, "");
  // El autocompletado de contactos en iOS entrega el número con código de
  // país (y a veces el "9" de celular) incluido, ej: "+54 9 351 234 5678".
  // Solo se pisa el prefijo si sobran dígitos — un número local que
  // arrancara con "54" por coincidencia no se toca.
  if (d.length > 10) {
    if (d.startsWith("549")) d = d.slice(3);
    else if (d.startsWith("54")) d = d.slice(2);
  }
  d = d.slice(0, 10);
  const isBsAs = d.slice(0, 2) === "11";
  const parts = isBsAs
    ? [d.slice(0, 2), d.slice(2, 6), d.slice(6, 10)]
    : [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)];
  return parts.filter(Boolean).join(" ");
}

/**
 * El backend espera el teléfono en E.164 (`+549` + 10 dígitos) — el `9` es el
 * prefijo de celular argentino, requerido para que la SMS gateway que emite
 * el OTP (`send-otp`) entregue el mensaje. El campo del formulario solo pide
 * y muestra el número local de 10 dígitos (ver `formatPhone`); esta función
 * arma el valor real que viaja en el body de cada request (`send-otp`,
 * `register`, `login`), nunca al revés.
 */
export function toE164Phone(localPhone: string): string {
  return `+549${localPhone.replace(/\D/g, "")}`;
}

/** Re-export de `src/lib/password-policy.ts` (extraído ahí en MOVO-136, ver ese
 * archivo) — los callers históricos del wizard lo siguen importando desde acá. */
export { isPasswordValid };


export function isDniValid(v: string): boolean {
  const d = v.replace(/\D/g, "");
  return d.length >= 7 && d.length <= 8;
}

export function formatDni(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function isZipValid(v: string): boolean {
  return /^\d{4}$/.test(v.trim());
}

export function formatZip(v: string): string {
  // El autocompletado de direcciones puede entregar el CPA argentino
  // completo (ej: "X5000ABC") en vez del CP numérico de 4 dígitos que
  // usamos acá — nos quedamos solo con los dígitos.
  return v.replace(/\D/g, "").slice(0, 4);
}

export function getFieldError(name: FieldName, fields: RegistrationFields): string {
  switch (name) {
    case "firstName":
      return fields.firstName.trim() ? "" : "Ingresá tu nombre";
    case "lastName":
      return fields.lastName.trim() ? "" : "Ingresá tu apellido";
    case "email":
      if (!fields.email.trim()) return "Ingresá tu email";
      return isEmailValid(fields.email) ? "" : "Ingresá un email válido";
    case "phone":
      if (!fields.phone.trim()) return "Ingresá tu teléfono";
      return isPhoneValid(fields.phone) ? "" : "Ingresá un teléfono válido";
    case "dni":
      return isDniValid(fields.dni) ? "" : "Ingresá un DNI válido (7 u 8 dígitos)";
    case "street":
      return fields.street.trim() ? "" : "Ingresá tu calle";
    case "number":
      return fields.number.trim() ? "" : "Ingresá el número";
    case "city":
      return fields.city.trim() ? "" : "Ingresá tu ciudad";
    case "province":
      return fields.province ? "" : "Elegí una provincia";
    case "zip":
      return isZipValid(fields.zip) ? "" : "Código postal de 4 dígitos";
    case "password":
      return isPasswordValid(fields.password)
        ? ""
        : "Mínimo 8 caracteres, con una letra y un número";
    case "passwordConfirm":
      return fields.passwordConfirm === fields.password ? "" : "Las contraseñas no coinciden";
    default:
      return "";
  }
}

export function isStepValid(step: 0 | 1 | 2 | 3, fields: RegistrationFields): boolean {
  if (step === 0) {
    return (
      !getFieldError("firstName", fields) &&
      !getFieldError("lastName", fields) &&
      !getFieldError("email", fields) &&
      !getFieldError("phone", fields)
    );
  }
  if (step === 1) {
    return !getFieldError("dni", fields);
  }
  if (step === 2) {
    return (
      !getFieldError("street", fields) &&
      !getFieldError("number", fields) &&
      !getFieldError("city", fields) &&
      !getFieldError("province", fields) &&
      !getFieldError("zip", fields)
    );
  }
  return !getFieldError("password", fields) && !getFieldError("passwordConfirm", fields);
}

interface RegistrationContextValue {
  fields: RegistrationFields;
  touched: Partial<Record<FieldName, boolean>>;
  setField: (name: FieldName, value: string) => void;
  touch: (name: FieldName) => void;
  touchAll: (names: FieldName[]) => void;

  userId: string | null;
  kycStatus: KycStatus | null;
  manualReviewReason: string | null;
  phoneVerifiedAt: string | null;
  /** No-null si el teléfono actual del formulario ya está verificado — permite
   * saltear el paso de OTP en `goNext`/`goBack` sin volver a pedir un código. */
  phoneVerificationToken: string | null;

  /** Pin del paso de mapa (MOVO-73) — null hasta que `geocodeAddress` lo centra por
   * primera vez o el usuario lo arrastra vía `confirmLocation`. */
  latitude: number | null;
  longitude: number | null;

  loading: boolean;
  errorBanner: string | null;
  clearErrorBanner: () => void;

  /** true mientras se está resolviendo si hay un registro pendiente al abrir la app (AC7). */
  resumeChecked: boolean;
  hasPendingRegistration: boolean;

  /** Envía el primer OTP al teléfono cargado en `fields`, antes de crear la cuenta. */
  sendOtp: () => Promise<{ ok: boolean; cooldownSeconds: number }>;
  verifyPhoneOtp: (code: string) => Promise<{ ok: boolean }>;
  resendOtp: () => Promise<{ ok: boolean; cooldownSeconds: number }>;
  /** Geocodifica la dirección cargada en `fields` para centrar el pin inicial del
   * paso de mapa. */
  geocodeAddress: () => Promise<{ ok: boolean }>;
  /** Guarda el lat/long final que el usuario confirmó (después de arrastrar el pin). */
  confirmLocation: (lat: number, long: number) => void;
  submitRegistration: () => Promise<{ ok: boolean }>;
  createKycSession: () => Promise<{ ok: boolean; sessionToken?: string }>;
  refreshKycStatus: () => Promise<void>;
  resetRegistration: () => Promise<void>;
  /** Puebla este contexto con la sesión que devuelve `login()` para una cuenta cuyo
   * KYC todavía no está aprobado — permite que `/kyc` (MOVO-73) sea la misma pantalla
   * de resultado tanto viniendo del wizard de registro como de un login a una cuenta
   * ya existente, en vez de una pantalla propia del login (ver `login.tsx`). */
  hydrateFromLogin: (session: {
    userId: string;
    accessToken: string;
    refreshToken: string;
    kycStatus: KycStatus;
  }) => Promise<void>;
}

const RegistrationContext = createContext<RegistrationContextValue | null>(null);

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<RegistrationFields>(EMPTY_FIELDS);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [manualReviewReason, setManualReviewReason] = useState<string | null>(null);
  const [otpId, setOtpId] = useState<string | null>(null);
  const [phoneVerificationToken, setPhoneVerificationToken] = useState<string | null>(null);
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState<string | null>(null);
  // Número (E.164) sobre el que se emitió `phoneVerificationToken` — permite saber si
  // la verificación sigue siendo válida para el teléfono actual del formulario, o si
  // quedó obsoleta porque el usuario volvió atrás y lo cambió.
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  // Tokens de sesión que emite `register()` (PR #51 de MOVO-72) — necesarios para el
  // header `Authorization` de /kyc/session y /kyc/status, protegidas desde ese mismo
  // cambio. `refreshToken` no se consume acá a propósito — ver comentario de la
  // "Limitación aceptada" más abajo.
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);

  // AC7: el flujo es reanudable. Persistimos `userId` + los tokens de sesión que
  // emite `register()` — sin el accessToken no hay forma de llamar a /kyc/status
  // (protegida desde PR #51 de MOVO-72). El paso en el que está el usuario se sigue
  // derivando siempre del backend (`kycStatus`), nunca de estado local.
  //
  // Limitación aceptada, decidida a propósito (no pendiente): el access token dura
  // 60min y este flujo no usa el refresh automático de MOVO-76 (`src/store/
  // auth-store.ts`) — es un token efímero de un wizard que todavía no terminó, no una
  // sesión autenticada, y sumarle refresh acoplaría dos conceptos que el código separa
  // a propósito (ver comentario en `secure-store.ts`). Si el usuario reabre la app
  // después de que expiró, `getKycStatus` devuelve 401 y acá se trata igual que "no
  // hay registro pendiente" — se limpia el storage y arranca el wizard desde cero.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedUserId, storedAccessToken] = await Promise.all([
        secureStore.getItem(SECURE_STORE_KEYS.pendingRegistrationUserId),
        secureStore.getItem(SECURE_STORE_KEYS.pendingRegistrationAccessToken),
      ]);
      if (!storedUserId || !storedAccessToken) {
        if (!cancelled) setResumeChecked(true);
        return;
      }
      try {
        const status = await authClient.getKycStatus(storedAccessToken);
        if (cancelled) return;
        setUserId(storedUserId);
        setAccessToken(storedAccessToken);
        setKycStatus(status.status);
        setManualReviewReason(status.manualReviewReason);
      } catch {
        // El userId/token guardado ya no es válido (cuenta eliminada, o access token
        // vencido sin refresh disponible todavía) — se limpia y se arranca de cero.
        await deletePendingRegistrationKeys(secureStore);
      } finally {
        if (!cancelled) setResumeChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = useCallback((name: FieldName, value: string) => {
    setFields((prev) => ({ ...prev, [name]: value }));
  }, []);

  // Si el usuario vuelve al paso 0 y cambia el teléfono después de haberlo verificado,
  // la verificación anterior deja de ser válida para el número nuevo — se invalida acá
  // en vez de en `setField` (que no tiene por qué conocer el estado de verificación)
  // para que el próximo paso de mapa vuelva a pedir un OTP en vez de saltearlo.
  useEffect(() => {
    if (verifiedPhone && toE164Phone(fields.phone) !== verifiedPhone) {
      setOtpId(null);
      setPhoneVerificationToken(null);
      setPhoneVerifiedAt(null);
      setVerifiedPhone(null);
    }
  }, [fields.phone, verifiedPhone]);

  const touch = useCallback((name: FieldName) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
  }, []);

  const touchAll = useCallback((names: FieldName[]) => {
    setTouched((prev) => {
      const next = { ...prev };
      for (const n of names) next[n] = true;
      return next;
    });
  }, []);

  const clearErrorBanner = useCallback(() => setErrorBanner(null), []);

  const submitRegistration = useCallback(async (): Promise<{ ok: boolean }> => {
    if (latitude === null || longitude === null) {
      setErrorBanner("Confirmá la ubicación en el mapa antes de continuar.");
      return { ok: false };
    }
    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.register({
        fullName: `${fields.firstName.trim()} ${fields.lastName.trim()}`.trim(),
        email: fields.email.trim().toLowerCase(),
        phone: toE164Phone(fields.phone),
        password: fields.password,
        dni: fields.dni.replace(/\D/g, ""),
        address: {
          street: fields.street,
          number: fields.number,
          floor: fields.floor || undefined,
          city: fields.city,
          province: fields.province,
          zip: fields.zip,
          lat: latitude,
          long: longitude,
        },
        phoneVerificationToken: phoneVerificationToken ?? "",
      });
      setUserId(response.userId);
      setKycStatus(response.kycStatus);
      setAccessToken(response.accessToken);
      // El phoneVerificationToken es de un solo uso y el backend ya lo consumió acá
      // arriba (auth.service.ts#register) — si queda en el contexto, un wizard que se
      // vuelve a montar (ver goNext en register.tsx) lo cree todavía válido, salta el
      // paso de OTP, y el segundo `register()` falla con AUTH_OTP_INVALID en vez de
      // pedir un código nuevo.
      setOtpId(null);
      setPhoneVerificationToken(null);
      setVerifiedPhone(null);
      await Promise.all([
        secureStore.setItem(SECURE_STORE_KEYS.pendingRegistrationUserId, response.userId),
        secureStore.setItem(SECURE_STORE_KEYS.pendingRegistrationAccessToken, response.accessToken),
        secureStore.setItem(SECURE_STORE_KEYS.pendingRegistrationRefreshToken, response.refreshToken),
      ]);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.code === "USER_EMAIL_ALREADY_EXISTS") {
        setTouched((prev) => ({ ...prev, email: true }));
        setErrorBanner("Este email ya está registrado. Iniciá sesión o probá con otro.");
      } else if (err instanceof ApiError && err.code === "USER_PHONE_ALREADY_EXISTS") {
        setTouched((prev) => ({ ...prev, phone: true }));
        setErrorBanner("Este teléfono ya está registrado. Iniciá sesión o probá con otro.");
      } else {
        setErrorBanner(friendlyErrorMessage(err, "No pudimos crear tu cuenta. Intentá de nuevo."));
      }
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }, [fields, phoneVerificationToken, latitude, longitude]);

  const sendOtp = useCallback(async (): Promise<{ ok: boolean; cooldownSeconds: number }> => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.sendOtp(toE164Phone(fields.phone));
      setOtpId(response.otpId);
      return { ok: true, cooldownSeconds: response.cooldownSeconds };
    } catch (err) {
      setErrorBanner(friendlyErrorMessage(err, "No pudimos enviar el código. Intentá de nuevo."));
      return { ok: false, cooldownSeconds: 60 };
    } finally {
      setLoading(false);
    }
  }, [fields.phone]);

  const verifyPhoneOtp = useCallback(
    async (code: string): Promise<{ ok: boolean }> => {
      if (!otpId) return { ok: false };
      setLoading(true);
      setErrorBanner(null);
      try {
        const response = await authClient.verifyOtp({ otpId, code });
        setPhoneVerificationToken(response.phoneVerificationToken);
        setPhoneVerifiedAt(response.phoneVerifiedAt);
        setVerifiedPhone(toE164Phone(fields.phone));
        return { ok: true };
      } catch (err) {
        setErrorBanner(friendlyErrorMessage(err, "No pudimos verificar el código. Intentá de nuevo."));
        return { ok: false };
      } finally {
        setLoading(false);
      }
    },
    [otpId, fields.phone],
  );

  const resendOtp = useCallback(async (): Promise<{ ok: boolean; cooldownSeconds: number }> => {
    if (!otpId) return { ok: false, cooldownSeconds: 60 };
    setErrorBanner(null);
    try {
      const response = await authClient.resendOtp(otpId);
      return { ok: true, cooldownSeconds: response.cooldownSeconds };
    } catch (err) {
      setErrorBanner(friendlyErrorMessage(err, "No pudimos reenviar el código. Intentá de nuevo."));
      return { ok: false, cooldownSeconds: 0 };
    }
  }, [otpId]);

  // Paso de mapa (MOVO-73): geocodifica la dirección ya cargada para centrar el pin
  // inicial. Público en el backend — se llama antes de crear la cuenta.
  const geocodeAddress = useCallback(async (): Promise<{ ok: boolean }> => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.geocodeAddress({
        street: fields.street,
        number: fields.number,
        floor: fields.floor || undefined,
        city: fields.city,
        province: fields.province,
        zip: fields.zip,
      });
      setLatitude(response.lat);
      setLongitude(response.long);
      return { ok: true };
    } catch (err) {
      setErrorBanner(friendlyErrorMessage(err, "No pudimos ubicar tu dirección en el mapa. Intentá de nuevo."));
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }, [fields.street, fields.number, fields.floor, fields.city, fields.province, fields.zip]);

  const confirmLocation = useCallback((lat: number, long: number) => {
    setLatitude(lat);
    setLongitude(long);
  }, []);

  const createKycSession = useCallback(async (): Promise<{ ok: boolean; sessionToken?: string }> => {
    const authState = useAuthStore.getState();
    if (!accessToken && authState.status !== "authenticated") return { ok: false };
    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.createKycSession(accessToken ?? undefined);
      return { ok: true, sessionToken: response.sessionToken };
    } catch (err) {
      setErrorBanner(friendlyErrorMessage(err, "No pudimos iniciar la verificación. Intentá de nuevo."));
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const refreshKycStatus = useCallback(async () => {
    const authState = useAuthStore.getState();
    if (!accessToken && authState.status !== "authenticated") return;
    try {
      const response = await authClient.getKycStatus(accessToken ?? undefined);
      setKycStatus(response.status);
      setManualReviewReason(response.manualReviewReason);
      const authUser = authState.user;
      if (authUser && authUser.kycStatus !== response.status) {
        await useAuthStore.getState().updateKycStatus(response.status);
      }
    } catch {
      // Silencioso: el polling de estado no debe tirar la pantalla abajo.
    }
  }, [accessToken]);

  const hydrateFromLogin = useCallback(
    async (session: {
      userId: string;
      accessToken: string;
      refreshToken: string;
      kycStatus: KycStatus;
    }) => {
      setUserId(session.userId);
      setAccessToken(session.accessToken);
      setKycStatus(session.kycStatus);
      setManualReviewReason(null);
      await Promise.all([
        secureStore.setItem(SECURE_STORE_KEYS.pendingRegistrationUserId, session.userId),
        secureStore.setItem(SECURE_STORE_KEYS.pendingRegistrationAccessToken, session.accessToken),
        secureStore.setItem(SECURE_STORE_KEYS.pendingRegistrationRefreshToken, session.refreshToken),
      ]);
    },
    [],
  );

  const resetRegistration = useCallback(async () => {
    await deletePendingRegistrationKeys(secureStore);
    setFields(EMPTY_FIELDS);
    setTouched({});
    setUserId(null);
    setKycStatus(null);
    setManualReviewReason(null);
    setOtpId(null);
    setPhoneVerificationToken(null);
    setPhoneVerifiedAt(null);
    setVerifiedPhone(null);
    setLatitude(null);
    setLongitude(null);
    setAccessToken(null);
    setErrorBanner(null);
  }, []);

  const authStatus = useAuthStore((s) => s.status);
  const prevAuthStatusRef = useRef(authStatus);

  useEffect(() => {
    if (prevAuthStatusRef.current === "authenticated" && authStatus === "unauthenticated") {
      void resetRegistration();
    }
    prevAuthStatusRef.current = authStatus;
  }, [authStatus, resetRegistration]);

  const value = useMemo<RegistrationContextValue>(
    () => ({
      fields,
      touched,
      setField,
      touch,
      touchAll,
      userId,
      kycStatus,
      manualReviewReason,
      phoneVerifiedAt,
      phoneVerificationToken,
      latitude,
      longitude,
      loading,
      errorBanner,
      clearErrorBanner,
      resumeChecked,
      hasPendingRegistration: Boolean(userId),
      sendOtp,
      verifyPhoneOtp,
      resendOtp,
      geocodeAddress,
      confirmLocation,
      submitRegistration,
      createKycSession,
      refreshKycStatus,
      resetRegistration,
      hydrateFromLogin,
    }),
    [
      fields,
      touched,
      setField,
      touch,
      touchAll,
      userId,
      kycStatus,
      manualReviewReason,
      phoneVerifiedAt,
      phoneVerificationToken,
      latitude,
      longitude,
      loading,
      errorBanner,
      clearErrorBanner,
      resumeChecked,
      sendOtp,
      verifyPhoneOtp,
      resendOtp,
      geocodeAddress,
      confirmLocation,
      submitRegistration,
      createKycSession,
      refreshKycStatus,
      resetRegistration,
      hydrateFromLogin,
    ],
  );

  return <RegistrationContext.Provider value={value}>{children}</RegistrationContext.Provider>;
}

export function useRegistration(): RegistrationContextValue {
  const ctx = useContext(RegistrationContext);
  if (!ctx) {
    throw new Error("useRegistration debe usarse dentro de <RegistrationProvider>");
  }
  return ctx;
}
