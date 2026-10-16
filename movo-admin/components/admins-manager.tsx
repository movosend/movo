"use client"
import { useActionState, useState } from "react"
import { LoaderCircle, UserPlus } from "lucide-react"
import { grantAdmin, revokeAdmin, type AdminsState } from "@/app/admins/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export interface AdminRowData {
  id: string
  fullName: string
  email: string
  suspended: boolean
  since: string
}

function GrantForm() {
  const [state, action, pending] = useActionState<AdminsState, FormData>(
    grantAdmin,
    {}
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Otorgar el rol de admin</CardTitle>
        <CardDescription>
          La persona tiene que tener cuenta en la app y el email verificado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="grant-email">Email</FieldLabel>
              <Input
                id="grant-email"
                name="email"
                type="email"
                autoComplete="off"
                required
                maxLength={254}
              />
            </Field>
          </FieldGroup>
          {state.error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {state.notice && (
            <Alert role="status">
              <AlertDescription>{state.notice}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <UserPlus data-icon="inline-start" />
            )}
            Otorgar rol
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function RevokeControl({ admin }: { admin: AdminRowData }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<AdminsState, FormData>(
    revokeAdmin,
    {}
  )
  if (!open)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Revocar el rol de ${admin.fullName}`}
      >
        Revocar
      </Button>
    )
  return (
    <form
      action={action}
      className="flex w-full max-w-sm flex-col gap-3"
      aria-label={`Revocar el rol de ${admin.fullName}`}
    >
      <input type="hidden" name="userId" value={admin.id} />
      <p className="text-sm text-muted-foreground">
        {admin.fullName} deja de ser admin y se cierra su sesión en el panel de
        inmediato.
      </p>
      <Field>
        <FieldLabel htmlFor={`reason-${admin.id}`}>Motivo</FieldLabel>
        <Input
          id={`reason-${admin.id}`}
          name="reason"
          required
          minLength={3}
          maxLength={500}
        />
      </Field>
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={pending}
        >
          {pending ? "Revocando…" : "Confirmar revocación"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

export function AdminsManager({
  admins,
  currentUserId,
  loadError,
}: {
  admins: AdminRowData[]
  currentUserId: string
  loadError?: string
}) {
  return (
    <div className="flex flex-col gap-6">
      <GrantForm />
      <Card>
        <CardHeader>
          <CardTitle>Administradores</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : (
            <ul className="divide-y">
              {admins.map((admin) => (
                <li
                  key={admin.id}
                  className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {admin.fullName}
                      {admin.id === currentUserId && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (vos)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {admin.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Admin desde {admin.since}
                      {admin.suspended && " · cuenta no activa"}
                    </p>
                  </div>
                  {admin.id !== currentUserId && (
                    <RevokeControl admin={admin} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
