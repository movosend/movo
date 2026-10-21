import { Pin } from "lucide-react"
import { cn } from "@/lib/utils"

/** Chinche de un post-it: asoma por arriba del papel. */
export function PostitPin({ className }: { className?: string }) {
  return (
    <Pin
      aria-hidden
      className={cn(
        "absolute -top-2.5 left-1/2 size-5 -translate-x-1/2 rotate-[-12deg] fill-[var(--danger-solid)] text-[var(--danger-solid)] drop-shadow-sm",
        className
      )}
    />
  )
}
