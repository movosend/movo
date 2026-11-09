"use client"
import { useState } from "react"
import { ImageOff, Maximize2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type GalleryPhoto = { key: string; label: string; url: string }

/*
 * Las fotos de Didit son links firmados y temporales (vencen a los 60 minutos): no se pueden optimizar ni cachear, por eso
 * van con `<img>` y no con `next/image`. `referrerPolicy="no-referrer"`: el link de Didit no tiene por qué saber desde qué
 * panel se abrió. Si una no carga (link vencido), se avisa en vez de dejar un hueco roto.
 */

function Broken({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`${label}: no se pudo cargar`}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-surface-sub p-3 text-center text-[11px] leading-snug text-muted-foreground",
        className
      )}
    >
      <ImageOff aria-hidden className="size-4" />
      No se pudo cargar. El link pudo vencer: recargá la página.
    </div>
  )
}

function Viewer({
  photo,
  onClose,
}: {
  photo: GalleryPhoto | null
  onClose: () => void
}) {
  return (
    <Dialog open={photo !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[92vh] max-w-[880px]"
      >
        <DialogHeader>
          <DialogTitle>{photo?.label}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center p-5">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- link firmado y temporal de Didit
            <img
              src={photo.url}
              alt={photo.label}
              referrerPolicy="no-referrer"
              className="max-h-[76vh] max-w-full rounded-lg object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Una foto que se amplía al tocarla. */
export function ZoomablePhoto({
  photo,
  className,
  fit = "cover",
}: {
  photo: GalleryPhoto
  className?: string
  /** `contain` para un documento entero (no se recorta), `cover` para una cara. */
  fit?: "cover" | "contain"
}) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  if (broken) return <Broken label={photo.label} className={className} />
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ampliar ${photo.label.toLowerCase()}`}
        className={cn(
          "group relative overflow-hidden rounded-xl border bg-muted shadow-[var(--shadow-1)] outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- link firmado y temporal de Didit */}
        <img
          src={photo.url}
          alt={photo.label}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
          className={cn(
            "size-full transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none",
            fit === "cover" ? "object-cover" : "object-contain"
          )}
        />
        <span
          aria-hidden
          className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-lg bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      <Viewer photo={open ? photo : null} onClose={() => setOpen(false)} />
    </>
  )
}

/**
 * La foto grande del resumen y, debajo, las miniaturas: tocar una miniatura la pone grande; tocar la grande la amplía.
 * La primera es la selfie de la verificación.
 */
export function SummaryPhotos({ photos }: { photos: GalleryPhoto[] }) {
  const [selected, setSelected] = useState(0)
  const [zoom, setZoom] = useState<GalleryPhoto | null>(null)
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set())
  const current = photos[Math.min(selected, photos.length - 1)]
  if (!current) return null
  const isBroken = broken.has(current.key)

  return (
    <div className="flex w-[148px] flex-none flex-col gap-2.5">
      {isBroken ? (
        <Broken label={current.label} className="aspect-[3/4] w-full" />
      ) : (
        <button
          type="button"
          onClick={() => setZoom(current)}
          aria-label={`Ampliar ${current.label.toLowerCase()}`}
          className="group relative aspect-[3/4] w-full overflow-hidden rounded-2xl border bg-muted shadow-[var(--shadow-3)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- link firmado y temporal de Didit */}
          <img
            src={current.url}
            alt={current.label}
            referrerPolicy="no-referrer"
            onError={() =>
              setBroken((prev) => new Set(prev).add(current.key))
            }
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
          />
          <span
            aria-hidden
            className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-lg bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <Maximize2 className="size-3.5" />
          </span>
        </button>
      )}
      {photos.length > 1 && (
        <div
          role="group"
          aria-label="Fotos de la verificación"
          className="flex flex-wrap gap-1.5"
        >
          {photos.map((photo, index) => {
            const on = photo.key === current.key
            return (
              <button
                key={photo.key}
                type="button"
                onClick={() => setSelected(index)}
                aria-pressed={on}
                aria-label={`Ver ${photo.label.toLowerCase()}`}
                title={photo.label}
                className={cn(
                  "size-10 overflow-hidden rounded-lg border-2 bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-foreground" : "border-transparent opacity-70 hover:opacity-100"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- link firmado y temporal de Didit */}
                <img
                  src={photo.url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              </button>
            )
          })}
        </div>
      )}
      <span className="text-xs leading-snug">
        <span className="font-medium">{current.label}</span>
        <span className="block text-muted-foreground">
          Tocá la foto para ampliarla
        </span>
      </span>
      <Viewer photo={zoom} onClose={() => setZoom(null)} />
    </div>
  )
}
