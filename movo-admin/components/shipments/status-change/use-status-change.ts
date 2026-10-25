"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  FORCE_STATUS_REASON_MIN_LENGTH,
  normalizeConfirmationCode,
  type ShipmentStatusOption,
  type ShipmentStatusOptions,
  type StepUpChallenge,
} from "@movo/shared/src/types/admin-shipments"
import {
  loadStatusOptions,
  sendStepUpCode,
  submitStatusChange,
} from "@/app/shipments/status-actions"
import type { ShipmentStatusValue } from "@/lib/shipments/format"
import type { StatusFailure, StatusResult } from "@/lib/shipments/status-result"
import { defaultTarget, newIdempotencyKey } from "./copy"

export type Step = 1 | 2 | 3

export interface StatusChangeDone {
  from: ShipmentStatusValue
  to: ShipmentStatusValue
  option: ShipmentStatusOption
  /** El código para tipear (`MOVO-12345`) que se muestra en el aviso. */
  code: string
}

interface State {
  step: Step
  /** Cargando las opciones (al abrir o al recargarlas tras un `STATUS_CHANGED`). */
  loading: boolean
  options: ShipmentStatusOptions | null
  loadError: string | null
  target: ShipmentStatusValue | null
  showForced: boolean
  reason: string
  typed: string
  code: string
  ack: boolean
  /** DD-055: asignar sin hold real de Mercado Pago (el envío queda sin cobro). Solo con destino `assigned`. */
  simulatePayment: boolean
  challenge: StepUpChallenge | null
  /** Hasta cuándo no se puede pedir otro código (epoch ms). */
  resendAt: number
  sendingCode: boolean
  /** Token del segundo factor ya verificado que un rechazo de negocio no gastó. */
  stepUpToken: string | null
  submitting: boolean
  /** Error para mostrar arriba del paso actual. */
  error: StatusFailure | null
  idempotencyKey: string
  /**
   * El último intento no tuvo respuesta y pudo aplicarse: el backend ya gastó el segundo factor y registró la clave, así
   * que el reintento con la MISMA clave no lo pide de nuevo (volver a verificar el código gastado daría `STEP_UP_INVALID`).
   */
  retryAfterUnknown: boolean
}

const initial = (): State => ({
  step: 1,
  // Las opciones se piden apenas se monta.
  loading: true,
  options: null,
  loadError: null,
  target: null,
  showForced: false,
  reason: "",
  typed: "",
  code: "",
  ack: false,
  simulatePayment: false,
  challenge: null,
  resendAt: 0,
  sendingCode: false,
  stepUpToken: null,
  submitting: false,
  error: null,
  idempotencyKey: newIdempotencyKey(),
  retryAfterUnknown: false,
})

/** Lo que dejó de servir cuando cambia el destino: lo tipeado, el check, el código y la clave eran del anterior. */
const resetForNewTarget = (): Partial<State> => ({
  typed: "",
  code: "",
  ack: false,
  simulatePayment: false,
  challenge: null,
  stepUpToken: null,
  resendAt: 0,
  retryAfterUnknown: false,
  error: null,
  // Una clave de idempotencia sirve para un solo destino.
  idempotencyKey: newIdempotencyKey(),
})

/**
 * Una Server Action puede rechazar con algo que no es un `ApiError` (se cortó el request a Next, falló la sesión): sin
 * esto el modal quedaría trabado en "cargando" o "aplicando". `maybeApplied`: si es el cambio, pudo haberse aplicado.
 */
async function safely<T>(
  call: () => Promise<StatusResult<T>>,
  maybeApplied = false
): Promise<StatusResult<T>> {
  try {
    return await call()
  } catch {
    return maybeApplied
      ? {
          ok: false,
          error:
            "No pudimos confirmar si el cambio se aplicó. Mirá la línea de tiempo antes de volver a intentar.",
          unconfirmed: true,
        }
      : {
          ok: false,
          error:
            "No pudimos completar la operación. Reintentá en unos momentos.",
        }
  }
}

/**
 * Estado y acciones del modal de cambio de estado (MOVO-333). Todo lo que decide qué es válido, su riesgo y lo que
 * se exige viene de `status-options`; acá solo se arma el recorrido de tres pasos. Un error nunca borra lo que el
 * admin escribió: solo se limpia lo que dejó de servir (un código vencido, una elección que ya no existe).
 */
export function useStatusChange({
  shipmentId,
  onDone,
}: {
  shipmentId: string
  onDone: (done: StatusChangeDone) => void
}) {
  const [state, setState] = useState<State>(initial)
  const patch = useCallback(
    (p: Partial<State> | ((s: State) => Partial<State>)) =>
      setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })),
    []
  )
  // Para que los handlers async lean el estado vigente sin volver a crearse en cada render.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })
  // Cada pedido de opciones lleva su número: solo vale la respuesta del último (una vieja no pisa a una nueva).
  const loadSeq = useRef(0)

  /** Aplica la respuesta de `status-options`; con `keep`, conserva la elección si sigue disponible. */
  const applyOptions = useCallback(
    (
      result: StatusResult<ShipmentStatusOptions>,
      keep: ShipmentStatusValue | null
    ) => {
      if (!result.ok) {
        patch({ loading: false, loadError: result.error })
        return
      }
      const { data } = result
      const still = keep && data.options.some((o) => o.targetStatus === keep)
      const target = still ? keep : defaultTarget(data)
      patch((s) => ({
        loading: false,
        loadError: null,
        options: data,
        target,
        // Si el destino cambió, lo del anterior no se arrastra (ni el check "Entiendo" ni un token atado a otro destino).
        ...(target !== s.target ? resetForNewTarget() : {}),
      }))
    },
    [patch]
  )

  /** Pide las opciones; solo la respuesta del pedido más reciente se aplica. */
  const fetchOptions = useCallback(
    (keep: ShipmentStatusValue | null) => {
      const id = ++loadSeq.current
      void safely(() => loadStatusOptions(shipmentId)).then((result) => {
        if (id === loadSeq.current) applyOptions(result, keep)
      })
    },
    [applyOptions, shipmentId]
  )

  /** Vuelve a pedir las opciones mostrando "cargando" (tras un `STATUS_CHANGED` o con "Reintentar"). */
  const reload = useCallback(
    (keep: ShipmentStatusValue | null) => {
      patch({ loading: true, loadError: null })
      fetchOptions(keep)
    },
    [fetchOptions, patch]
  )

  // El modal se monta solo mientras está abierto: el estado arranca de cero y se descarta al cerrar (incluido un token
  // sin usar). Al montarse pide las opciones; al desmontarse invalida lo que quede en vuelo.
  useEffect(() => {
    fetchOptions(null)
    const seq = loadSeq
    return () => {
      seq.current++
    }
  }, [fetchOptions])

  const option =
    state.options?.options.find((o) => o.targetStatus === state.target) ?? null
  const reasonOk = state.reason.trim().length >= FORCE_STATUS_REASON_MIN_LENGTH
  const typedOk =
    !option?.requiresTypedCode ||
    (!!state.options &&
      normalizeConfirmationCode(state.typed) === state.options.code)
  const otpOk =
    !option?.requiresStepUp ||
    state.retryAfterUnknown ||
    !!state.stepUpToken ||
    (!!state.challenge && /^\d{6}$/.test(state.code))
  const canConfirm = reasonOk && typedOk && otpOk && state.ack
  const canNext = state.step < 3 ? !!option : canConfirm
  const busy = state.loading || state.submitting

  const pick = useCallback(
    (target: ShipmentStatusValue) =>
      patch((s) =>
        s.target === target ? {} : { target, ...resetForNewTarget() }
      ),
    [patch]
  )

  const sendCode = useCallback(async () => {
    const target = stateRef.current.target
    if (!target || stateRef.current.sendingCode) return
    patch({ sendingCode: true, error: null })
    const result = await safely(() => sendStepUpCode(shipmentId, target))
    if (!result.ok) {
      patch({ sendingCode: false, error: result })
      return
    }
    patch({
      sendingCode: false,
      challenge: result.data,
      code: "",
      resendAt: Date.now() + result.data.cooldownSeconds * 1000,
    })
  }, [patch, shipmentId])

  const handleFailure = useCallback(
    (failure: StatusFailure) => {
      const s = stateRef.current
      if (
        failure.code === "STATUS_CHANGED" ||
        failure.code === "TRANSITION_NOT_ALLOWED"
      ) {
        // El estado cambió: se vuelve al paso 1 con las opciones nuevas y lo escrito intacto.
        patch({
          step: 1,
          error: failure,
          stepUpToken: failure.stepUpToken ?? s.stepUpToken,
          idempotencyKey: newIdempotencyKey(),
        })
        reload(s.target)
        return
      }
      const spentCode =
        failure.code === "STEP_UP_INVALID" ||
        failure.code === "STEP_UP_REQUIRED"
      patch({
        error: failure,
        ...(spentCode
          ? {
              code: "",
              challenge: null,
              stepUpToken: null,
              resendAt: 0,
              retryAfterUnknown: false,
            }
          : {
              stepUpToken: failure.stepUpToken ?? null,
              // Sin respuesta del backend: pudo aplicarse y ya gastó el segundo factor. El reintento (misma clave) no lo
              // vuelve a pedir; si igual lo exige, vuelve como `STEP_UP_REQUIRED` y se pide uno nuevo.
              retryAfterUnknown: !!failure.unconfirmed || s.retryAfterUnknown,
            }),
      })
    },
    [patch, reload]
  )

  const confirm = useCallback(async () => {
    const s = stateRef.current
    if (!s.options || !s.target || s.submitting) return
    const chosen = s.options.options.find((o) => o.targetStatus === s.target)
    if (!chosen) return
    patch({ submitting: true, error: null })
    const target = s.target
    const expectedStatus = s.options.current
    const result = await safely(
      () =>
        submitStatusChange(shipmentId, {
          targetStatus: target,
          expectedStatus,
          reason: s.reason,
          idempotencyKey: s.idempotencyKey,
          ...(s.simulatePayment && target === "assigned"
            ? { simulatePayment: true }
            : {}),
          ...(chosen.requiresTypedCode ? { typedCode: s.typed } : {}),
          ...(chosen.requiresStepUp && !s.retryAfterUnknown
            ? s.stepUpToken
              ? { stepUpToken: s.stepUpToken }
              : s.challenge
                ? {
                    otp: { challengeId: s.challenge.challengeId, code: s.code },
                  }
                : {}
            : {}),
        }),
      true
    )
    patch({ submitting: false })
    if (result.ok) {
      onDone({
        from: s.options.current,
        to: s.target,
        option: chosen,
        code: s.options.code,
      })
      return
    }
    handleFailure(result)
  }, [handleFailure, onDone, patch, shipmentId])

  const next = useCallback(() => {
    const s = stateRef.current
    if (s.step < 3) {
      if (s.options?.options.some((o) => o.targetStatus === s.target))
        patch({ step: (s.step + 1) as Step, error: null })
      return
    }
    void confirm()
  }, [confirm, patch])

  const back = useCallback(
    () =>
      patch((s) =>
        s.step > 1 ? { step: (s.step - 1) as Step, error: null } : {}
      ),
    [patch]
  )

  return {
    state,
    option,
    typedOk,
    canNext,
    busy,
    pick,
    next,
    back,
    sendCode,
    reload: () => reload(stateRef.current.target),
    setReason: (reason: string) => patch({ reason }),
    setTyped: (typed: string) => patch({ typed }),
    setCode: (code: string) =>
      patch({ code: code.replace(/\D/g, "").slice(0, 6) }),
    setAck: (ack: boolean) => patch({ ack }),
    // La clave de idempotencia identifica UN cambio: con otra opción es otro pedido (si no, tras un intento sin
    // respuesta el backend repetiría el resultado anterior e ignoraría el check).
    setSimulatePayment: (simulatePayment: boolean) =>
      patch({
        simulatePayment,
        idempotencyKey: newIdempotencyKey(),
        // Es otro cambio: el segundo factor del anterior (gastado o no) no sirve.
        retryAfterUnknown: false,
        code: "",
        challenge: null,
        stepUpToken: null,
        resendAt: 0,
      }),
    toggleForced: () => patch((s) => ({ showForced: !s.showForced })),
  }
}
