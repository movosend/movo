import { notFound } from "next/navigation"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { ThreadView } from "@/components/support/thread/thread-view"
import { requireAdmin } from "@/lib/auth/session"
import { getConversation, getMessages } from "@/lib/support/api"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const admin = await requireAdmin(false, `/support/${id}`)
  const actor = { adminId: admin.id, adminName: admin.fullName }
  let loaded
  try {
    loaded = await Promise.all([
      getConversation(id, actor),
      getMessages(id, undefined, actor),
    ])
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) notFound()
    throw error
  }
  const [conversation, messages] = loaded
  return (
    <ThreadView
      key={id}
      me={{ id: admin.id, fullName: admin.fullName }}
      initialConversation={conversation}
      initialMessages={messages}
    />
  )
}
