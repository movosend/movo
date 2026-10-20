import { redirect } from "next/navigation"
import { readReset } from "@/lib/auth/session"
import { ForgotForm } from "@/components/forgot-form"

export default async function ForgotNewPage() {
  const flow = await readReset()
  if (!flow?.passwordResetToken) redirect("/forgot")
  return <ForgotForm step="password" />
}
