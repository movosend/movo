export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium">Esa consulta no existe.</p>
      <p className="text-[13px] text-muted-foreground">
        Puede que el link esté mal. Elegí otra de la lista.
      </p>
    </div>
  )
}
