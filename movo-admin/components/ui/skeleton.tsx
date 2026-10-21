import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("mv-skeleton rounded-md", className)}
      {...props}
    />
  )
}

/**
 * Contenedor de una zona en carga: anuncia el estado a lectores de pantalla una sola
 * vez (en vez de cada bloque) y marca el área como ocupada.
 */
function SkeletonGroup({
  label = "Cargando…",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { label?: string }) {
  return (
    <div
      data-slot="skeleton-group"
      role="status"
      aria-busy="true"
      className={className}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export { Skeleton, SkeletonGroup }
