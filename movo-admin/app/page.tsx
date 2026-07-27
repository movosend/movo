import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div
      className="flex min-h-svh items-center justify-center p-6"
      style={{
        backgroundColor: "#C6F24A",
        backgroundImage:
          "radial-gradient(rgba(0,0,0,0.15) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="text-2xl font-semibold text-black">
          admin.movosend.app
        </span>
        <h1 className="text-xl font-medium text-black">
          Panel de administración en construcción
        </h1>
        <p className="text-sm text-black/70">
          Todavía no hay nada para ver aquí.
        </p>
        <Button className="mt-2 bg-black text-white hover:bg-black/80">
          <a href="https://movosend.app">Ir a la página inicial</a>
        </Button>
      </div>
    </div>
  )
}
