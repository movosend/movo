import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initialsOf } from "@/lib/initials"

/** Foto de perfil real (URL pública de S3, DD-016); sin foto o si no carga, las iniciales. */
export function UserAvatar({
  name,
  photoUrl,
  size = 32,
  className,
}: {
  name: string
  photoUrl?: string | null
  size?: number
  className?: string
}) {
  return (
    <Avatar
      aria-hidden
      style={{ width: size, height: size }}
      className={className}
    >
      {photoUrl && (
        <AvatarImage src={photoUrl} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback
        className="bg-avatar text-xs font-semibold text-foreground"
        style={{ fontSize: size <= 28 ? 11 : 12 }}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}
