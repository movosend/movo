import type { Metadata } from "next"
import { EmptyThread } from "@/components/support/inbox-frame"

export const metadata: Metadata = { title: "Soporte" }

export default function Page() {
  return <EmptyThread />
}
