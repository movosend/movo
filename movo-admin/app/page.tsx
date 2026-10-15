import { requireAdmin } from "@/lib/auth/session"
import { AdminShell } from "@/components/admin-shell"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { ShieldCheck } from "lucide-react"
export default async function Page() {
  const profile = await requireAdmin()
  return (
    <AdminShell fullName={profile.fullName}>
      <section className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Panel de administración</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Hola, {profile.fullName.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground">
          Bienvenido al espacio de trabajo de Movo.
        </p>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Todo listo para empezar</CardTitle>
          <CardDescription>Tu acceso al panel está habilitado.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <ShieldCheck />
            <AlertTitle>Sesión protegida</AlertTitle>
            <AlertDescription>
              Ingresaste con tu cuenta y un código de verificación por email.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            Las herramientas de operación se habilitarán en próximas entregas.
            Podés ver las secciones previstas en el menú.
          </p>
        </CardFooter>
      </Card>
    </AdminShell>
  )
}
