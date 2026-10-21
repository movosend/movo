import {
  BadgeCheck,
  Bike,
  Package,
  ShieldAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import type { SupportTopic } from "@movo/shared/src/types/admin-support"

const ICONS: Record<SupportTopic, LucideIcon> = {
  shipment: Package,
  payments: Wallet,
  account: BadgeCheck,
  carrier: Bike,
  security: ShieldAlert,
}

export function TopicIcon({
  topic,
  className,
}: {
  topic: SupportTopic
  className?: string
}) {
  const Icon = ICONS[topic]
  return <Icon aria-hidden className={className ?? "size-3"} />
}
