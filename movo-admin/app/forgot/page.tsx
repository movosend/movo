import type { Metadata } from "next"
import { ForgotForm } from "@/components/forgot-form"

export const metadata: Metadata = { title: "Recuperar contraseña" }

export default function ForgotPage() {
  return <ForgotForm step="identify" />
}
