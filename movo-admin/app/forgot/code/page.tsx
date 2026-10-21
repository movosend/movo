import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { readReset } from "@/lib/auth/session"
import { ForgotForm } from "@/components/forgot-form"

export const metadata: Metadata = { title: "Recuperar contraseña" }

export default async function ForgotCodePage() {
  const flow = await readReset()
  if (!flow) redirect("/forgot")
  if (flow.passwordResetToken) redirect("/forgot/new")
  return (
    <ForgotForm
      step="code"
      flow={{
        target: flow.target,
        channel: flow.channel,
        resendAt: flow.resendAt,
      }}
    />
  )
}
