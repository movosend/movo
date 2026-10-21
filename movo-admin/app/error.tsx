"use client"
import { Button } from "@/components/ui/button"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-5 p-6">
      <Alert>
        <AlertTitle>No pudimos cargar el panel</AlertTitle>
        <AlertDescription>
          Movo no está disponible en este momento. Podés volver a intentar.
        </AlertDescription>
      </Alert>
      <Button onClick={reset}>Reintentar</Button>
    </main>
  )
}
