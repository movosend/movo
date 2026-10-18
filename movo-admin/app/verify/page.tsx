import { redirect } from "next/navigation"
import { readChallenge } from "@/lib/auth/session"
import { AuthForm } from "@/components/auth-form"
export default async function VerifyPage() {
  const challenge = await readChallenge()
  if (!challenge) redirect("/login")
  return (
    <AuthForm
      challenge={{ email: challenge.email, resendAt: challenge.resendAt }}
    />
  )
}
