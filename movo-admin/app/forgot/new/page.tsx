import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { readReset } from "@/lib/auth/session"
import { ForgotForm } from "@/components/forgot-form"

export const metadata: Metadata = { title: "Nueva contraseña" }

export default async function ForgotNewPage() {
  const flow = await readReset()
  if (!flow?.passwordResetToken) redirect("/forgot")
  return <ForgotForm step="password" />
}
