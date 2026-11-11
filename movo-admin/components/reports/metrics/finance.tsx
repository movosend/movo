import { Info, TriangleAlert } from "lucide-react"
import type { FinanceReport } from "@movo/shared/src/types/admin-reports"
import { formatMetric } from "@/lib/reports/format"

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/**
 * Lo que Finanzas no suma en sus totales (B8 de MOVO-35): las capturas que Mercado Pago todavía no
 * confirmó y las que pasaron a proceso manual. Van aparte y con su monto, nunca como cero.
 */
export function FinanceNotices({ report }: { report: FinanceReport }) {
  const { pendingConfirmation: pending, escalated } = report
  if (pending.count === 0 && escalated.count === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {pending.count > 0 && (
        <p className="flex items-start gap-2 text-[13px] text-fg2">
          <Info className="mt-0.5 size-3.5 flex-none text-muted-foreground" />
          {plural(pending.count, "cobro espera", "cobros esperan")} que Mercado
          Pago confirme la captura ({formatMetric("ars", pending.amountArs)}).
          No entran en lo cobrado, el fee ni el neto hasta entonces.
        </p>
      )}
      {escalated.count > 0 && (
        <p className="flex items-start gap-2 text-[13px] text-warn-fg">
          <TriangleAlert className="text-warn-icon mt-0.5 size-3.5 flex-none" />
          {plural(
            escalated.count,
            "cobro pasó",
            "cobros pasaron"
          )} a proceso manual ({formatMetric("ars", escalated.amountArs)}).
          Tampoco entran en los totales.
        </p>
      )}
    </div>
  )
}

/** Foto de la cuenta corriente al cierre del rango: quiénes deben y cuánto les debe Movo. */
export function DebtSnapshot({ report }: { report: FinanceReport }) {
  const { debt, kpis } = report
  const items = [
    {
      label: "Deuda abierta",
      value: formatMetric("ars", kpis.openDebt.value),
      sub: plural(debt.debtorUsers, "usuario con deuda", "usuarios con deuda"),
    },
    {
      label: "Saldo a favor de usuarios",
      value: formatMetric("ars", debt.creditArs),
      sub: plural(debt.creditUsers, "usuario", "usuarios"),
    },
  ]
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border bg-card p-[18px]">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold">
          Cuenta corriente al cierre del rango
        </h2>
        <span className="text-[13px] text-pretty text-fg2">
          El saldo de cada usuario como lo ve la app: sin lo anulado ni lo que
          un pago en curso todavía no cobró.
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-col gap-1 rounded-lg bg-muted px-3.5 py-3"
          >
            <dt className="text-[13px] text-fg2">{item.label}</dt>
            <dd className="text-[22px] leading-none font-semibold tabular-nums">
              {item.value}
            </dd>
            <dd className="text-xs text-muted-foreground">{item.sub}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
