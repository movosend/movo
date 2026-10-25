"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  FORCE_STATUS_REASON_MIN_LENGTH,
  normalizeConfirmationCode,
  type ChangeShipmentStatusResponse,
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
import type { StatusFailure } from "@/lib/shipments/status-result"
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
  challenge: null,
  resendAt: 0,
  sendingCode: false,
  stepUpToken: null,
  submitting: false,
  error: null,
  idempotencyKey: newIdempotencyKey(),
})

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

  /** Aplica la respuesta de `status-options`; con `keep`, conserva la elección si sigue disponible. */
  const applyOptions = useCallback(
    (
      result: Awaited<ReturnType<typeof loadStatusOptions>>,
      keep: ShipmentStatusValue | null
    ) => {
      if (!result.ok) {
        patch({ loading: false, loadError: result.error })
        return
      }
      const { data } = result
      const still = keep && data.options.some((o) => o.targetStatus === keep)
      patch({
        loading: false,
        loadError: null,
        options: data,
        target: still ? keep : defaultTarget(data),
      })
    },
    [patch]
  )

  /** Vuelve a pedir las opciones mostrando "cargando" (tras un `STATUS_CHANGED` o con "Reintentar"). */
  const reload = useCallback(
    (keep: ShipmentStatusValue | null) => {
      patch({ loading: true, loadError: null })
      void loadStatusOptions(shipmentId).then((r) => applyOptions(r, keep))
    },
    [applyOptions, patch, shipmentId]
  )

  // El modal se monta solo mientras está abierto: el estado arranca de cero y se descarta al cerrar (incluido un token
  // sin usar). Al montarse pide las opciones.
  useEffect(() => {
    let cancelled = false
    void loadStatusOptions(shipmentId).then((result) => {
      if (!cancelled) applyOptions(result, null)
    })
    return () => {
      cancelled = true
    }
  }, [applyOptions, shipmentId])

  const option =
    state.options?.options.find((o) => o.targetStatus === state.target) ?? null
  const needCode = !!option?.requiresTypedCode
  const needOtp = !!option?.requiresStepUp
  const reasonOk = state.reason.trim().length >= FORCE_STATUS_REASON_MIN_LENGTH
  const typedOk =
    !needCode ||
    (!!state.options &&
      normalizeConfirmationCode(state.typed) === state.options.code)
  const otpOk =
    !needOtp ||
    !!state.stepUpToken ||
    (!!state.challenge && /^\d{6}$/.test(state.code))
  const canConfirm = reasonOk && typedOk && otpOk && state.ack
  const canNext = state.step < 3 ? !!option : canConfirm
  const busy = state.loading || state.submitting

  const pick = useCallback(
    (target: ShipmentStatusValue) =>
      patch((s) =>
        s.target === target
          ? {}
          : {
              target,
              // Lo que se tipeó, el código y el check eran de la elección anterior.
              typed: "",
              code: "",
              ack: false,
              challenge: null,
              stepUpToken: null,
              resendAt: 0,
              error: null,
              // Una clave de idempotencia sirve para un solo destino.
              idempotencyKey: newIdempotencyKey(),
            }
      ),
    [patch]
  )

  const sendCode = useCallback(async () => {
    const s = stateRef.current
    if (!s.target || s.sendingCode) return
    patch({ sendingCode: true, error: null })
    const result = await sendStepUpCode(shipmentId, s.target)
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
          ? { code: "", challenge: null, stepUpToken: null, resendAt: 0 }
          : { stepUpToken: failure.stepUpToken ?? null }),
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
    const result = await submitStatusChange(shipmentId, {
      targetStatus: s.target,
      expectedStatus: s.options.current,
      reason: s.reason,
      idempotencyKey: s.idempotencyKey,
      ...(chosen.requiresTypedCode ? { typedCode: s.typed } : {}),
      ...(chosen.requiresStepUp
        ? s.stepUpToken
          ? { stepUpToken: s.stepUpToken }
          : s.challenge
            ? { otp: { challengeId: s.challenge.challengeId, code: s.code } }
            : {}
        : {}),
    })
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
    needCode,
    needOtp,
    reasonOk,
    typedOk,
    otpOk,
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
    toggleForced: () => patch((s) => ({ showForced: !s.showForced })),
  }
}

export type StatusChange = ReturnType<typeof useStatusChange>
export type { ChangeShipmentStatusResponse }
