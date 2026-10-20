import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { getUserProfile } from "@/lib/users/api"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { FichaIndex } from "@/components/users/ficha-index"
import { FichaProvider } from "@/components/users/ficha-status"
import { KpiStrip } from "@/components/users/kpi-strip"
import { SectionLoading } from "@/components/users/section-loading"
import { type SectionId } from "@/components/users/sections-meta"
import { SectionShell } from "@/components/users/ui"
import { AccountBanner, UserHeader } from "@/components/users/user-header"
import { ActivitySection } from "@/components/users/sections/activity-section"
import { AuditSection } from "@/components/users/sections/audit-section"
import { DevicesSection } from "@/components/users/sections/devices-section"
import { KycSection } from "@/components/users/sections/kyc-section"
import { NotesSection } from "@/components/users/sections/notes-section"
import { LedgerSection } from "@/components/users/sections/ledger-section"
import {
  BlocksSection,
  ReportsSection,
} from "@/components/users/sections/moderation-sections"
import { ProfileSection } from "@/components/users/sections/profile-section"
import { RatingsSection } from "@/components/users/sections/ratings-section"
import { SanctionsSection } from "@/components/users/sections/sanctions-section"
import { VehicleSection } from "@/components/users/sections/vehicle-section"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Streamed({
  id,
  children,
}: {
  id: SectionId
  children: React.ReactNode
}) {
  return (
    <Suspense
      fallback={
        <SectionShell id={id}>
          <SectionLoading id={id} />
        </SectionShell>
      }
    >
      {children}
    </Suspense>
  )
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const admin = await requireAdmin(false, `/users/${id}`)
  const shell = {
    fullName: admin.fullName,
    email: admin.email,
    photoUrl: admin.photoUrl,
    defaultOpen: await sidebarDefaultOpen(),
    current: "/users" as const,
  }

  // Única llamada que bloquea la página: da la cabecera, el banner y el contexto de las secciones.
  let user
  try {
    user = await getUserProfile(id)
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) notFound()
    return (
      <AdminShell {...shell}>
        <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-4 px-5 pt-6 pb-16 md:px-8">
          <Alert variant="destructive" className="w-auto">
            <AlertDescription>{publicError(error)}</AlertDescription>
          </Alert>
          <Link
            href={`/users/${id}`}
            className="text-sm font-medium underline underline-offset-4"
          >
            Reintentar
          </Link>
          <Link
            href="/users"
            className="text-sm text-fg2 hover:text-foreground"
          >
            Volver a usuarios
          </Link>
        </div>
      </AdminShell>
    )
  }

  const isCarrier = user.roles.some((r) => r.role === "carrier")
  return (
    <AdminShell {...shell} crumb={user.fullName}>
      <FichaProvider>
        <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-5 pt-6 pb-28 md:px-8">
          <UserHeader user={user} isSelf={admin.id === user.id}>
            <KpiStrip />
          </UserHeader>
          <AccountBanner user={user} />
          <div className="grid items-start gap-6 min-[1100px]:grid-cols-[184px_minmax(0,1fr)]">
            <FichaIndex />
            <div className="flex min-w-0 flex-col gap-4">
              <ProfileSection profile={user} />
              <Streamed id="kyc">
                <KycSection id={id} isCarrier={isCarrier} />
              </Streamed>
              <Streamed id="vehiculo">
                <VehicleSection id={id} isCarrier={isCarrier} />
              </Streamed>
              <Streamed id="actividad">
                <ActivitySection id={id} isCarrier={isCarrier} />
              </Streamed>
              <Streamed id="calificaciones">
                <RatingsSection id={id} />
              </Streamed>
              <Streamed id="reportes">
                <ReportsSection id={id} />
              </Streamed>
              <Streamed id="bloqueos">
                <BlocksSection id={id} />
              </Streamed>
              <Streamed id="sanciones">
                <SanctionsSection id={id} bannedUntil={user.bannedUntil} />
              </Streamed>
              <Streamed id="cuenta">
                <LedgerSection id={id} />
              </Streamed>
              <Streamed id="dispositivos">
                <DevicesSection id={id} />
              </Streamed>
              <Streamed id="notas">
                <NotesSection
                  id={id}
                  fullName={user.fullName}
                  isSelf={admin.id === user.id}
                />
              </Streamed>
              <Streamed id="bitacora">
                <AuditSection id={id} />
              </Streamed>
            </div>
          </div>
        </div>
      </FichaProvider>
    </AdminShell>
  )
}

export const dynamic = "force-dynamic"
