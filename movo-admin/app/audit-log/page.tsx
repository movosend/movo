import type { Metadata } from "next"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { getAuditLog, listAuditAdmins } from "@/lib/reports/api"
import {
  auditFilterQuery,
  auditHref,
  parseAuditState,
} from "@/lib/reports/params"
import { argentinaDay } from "@/lib/shipments/format"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuditLogView } from "@/components/reports/audit/audit-log-view"
import { ToastProvider } from "@/components/reports/toasts"

export const metadata: Metadata = { title: "Bitácora" }

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const state = parseAuditState(await searchParams)
  const returnTo = auditHref(state)
  const profile = await requireAdmin(false, returnTo)
  const result = await getAuditLog(state).then(
    (page) => ({ page, error: null }),
    (error: unknown) => ({ page: null, error: publicError(error) })
  )
  const admins = result.page ? await listAuditAdmins(result.page) : []

  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/audit-log"
    >
      <ToastProvider>
        {result.page ? (
          <AuditLogView
            // Filtros nuevos = lista nueva (la página siguiente se pide con el filtro de esta).
            key={auditFilterQuery(state)}
            state={state}
            initial={result.page}
            admins={admins}
            today={argentinaDay(new Date())}
          />
        ) : (
          <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 pt-7 pb-14 md:px-8">
            <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
              Bitácora
            </h1>
            <Alert variant="destructive" className="w-auto">
              <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>No pudimos cargar la bitácora. {result.error}</span>
                <a
                  href={returnTo}
                  className="font-medium underline underline-offset-4"
                >
                  Reintentar
                </a>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </ToastProvider>
    </AdminShell>
  )
}
