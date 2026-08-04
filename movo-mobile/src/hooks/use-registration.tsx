import { KycStatus } from "@movo/shared/dist/types/user";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authClient } from "../api/auth-client";
import { friendlyErrorMessage } from "../lib/error-messages";
import { SECURE_STORE_KEYS, secureStore } from "../lib/secure-store";

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

export function isPasswordValid(v: string): boolean {
  return v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);
}

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
  phoneVerifiedAt: string | null;

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
  submitRegistration: () => Promise<{ ok: boolean }>;
  createKycSession: () => Promise<{ ok: boolean; sessionToken?: string }>;
  refreshKycStatus: () => Promise<void>;
  resetRegistration: () => Promise<void>;
}

const RegistrationContext = createContext<RegistrationContextValue | null>(null);

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<RegistrationFields>(EMPTY_FIELDS);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [otpId, setOtpId] = useState<string | null>(null);
  const [phoneVerificationToken, setPhoneVerificationToken] = useState<string | null>(null);
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);

  // AC7: el flujo es reanudable. Solo persistimos el `userId` — el paso en
  // el que está el usuario se deriva siempre del backend, nunca de estado
  // local (guía explícita del ticket).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const storedUserId = await secureStore.getItem(SECURE_STORE_KEYS.pendingRegistrationUserId);
      if (!storedUserId) {
        if (!cancelled) setResumeChecked(true);
        return;
      }
      try {
        const status = await authClient.getKycStatus(storedUserId);
        if (cancelled) return;
        setUserId(storedUserId);
        setKycStatus(status.kycStatus);
      } catch {
        // El userId guardado ya no es válido (ej: cuenta eliminada) — se limpia.
        await secureStore.deleteItem(SECURE_STORE_KEYS.pendingRegistrationUserId);
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
    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.register({
        fullName: `${fields.firstName.trim()} ${fields.lastName.trim()}`.trim(),
        email: fields.email.trim().toLowerCase(),
        phone: fields.phone,
        password: fields.password,
        dni: fields.dni,
        address: {
          street: fields.street,
          number: fields.number,
          floor: fields.floor || undefined,
          city: fields.city,
          province: fields.province,
          zip: fields.zip,
        },
        phoneVerificationToken: phoneVerificationToken ?? "",
      });
      setUserId(response.userId);
      setKycStatus(response.kycStatus);
      await secureStore.setItem(SECURE_STORE_KEYS.pendingRegistrationUserId, response.userId);
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
  }, [fields, phoneVerificationToken]);

  const sendOtp = useCallback(async (): Promise<{ ok: boolean; cooldownSeconds: number }> => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.sendOtp(fields.phone);
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
        return { ok: true };
      } catch (err) {
        setErrorBanner(friendlyErrorMessage(err, "No pudimos verificar el código. Intentá de nuevo."));
        return { ok: false };
      } finally {
        setLoading(false);
      }
    },
    [otpId],
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

  const createKycSession = useCallback(async (): Promise<{ ok: boolean; sessionToken?: string }> => {
    if (!userId) return { ok: false };
    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.createKycSession(userId);
      return { ok: true, sessionToken: response.sessionToken };
    } catch (err) {
      setErrorBanner(friendlyErrorMessage(err, "No pudimos iniciar la verificación. Intentá de nuevo."));
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const refreshKycStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await authClient.getKycStatus(userId);
      setKycStatus(response.kycStatus);
    } catch {
      // Silencioso: el polling de estado no debe tirar la pantalla abajo.
    }
  }, [userId]);

  const resetRegistration = useCallback(async () => {
    await secureStore.deleteItem(SECURE_STORE_KEYS.pendingRegistrationUserId);
    setFields(EMPTY_FIELDS);
    setTouched({});
    setUserId(null);
    setKycStatus(null);
    setOtpId(null);
    setPhoneVerificationToken(null);
    setPhoneVerifiedAt(null);
    setErrorBanner(null);
  }, []);

  const value = useMemo<RegistrationContextValue>(
    () => ({
      fields,
      touched,
      setField,
      touch,
      touchAll,
      userId,
      kycStatus,
      phoneVerifiedAt,
      loading,
      errorBanner,
      clearErrorBanner,
      resumeChecked,
      hasPendingRegistration: Boolean(userId),
      sendOtp,
      verifyPhoneOtp,
      resendOtp,
      submitRegistration,
      createKycSession,
      refreshKycStatus,
      resetRegistration,
    }),
    [
      fields,
      touched,
      setField,
      touch,
      touchAll,
      userId,
      kycStatus,
      phoneVerifiedAt,
      loading,
      errorBanner,
      clearErrorBanner,
      resumeChecked,
      sendOtp,
      verifyPhoneOtp,
      resendOtp,
      submitRegistration,
      createKycSession,
      refreshKycStatus,
      resetRegistration,
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
