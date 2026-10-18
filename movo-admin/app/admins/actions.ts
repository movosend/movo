"use server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { gateway, publicError } from "@/lib/auth/api"
import {
  assertOrigin,
  requireAdmin,
  type AdminProfile,
} from "@/lib/auth/session"
import { ACCESS_COOKIE } from "@/lib/auth/policy"

export interface AdminsState {
  error?: string
  notice?: string
}

// Con el gateway o un servicio caído `requireAdmin` lanza un ApiError 5xx: se devuelve como estado
// del formulario en vez de subir al error boundary. Un 401/403 redirige (NEXT_REDIRECT, que no es un
// ApiError) y se deja pasar.
async function authorize(): Promise<AdminProfile | { error: string }> {
  try {
    return await requireAdmin(true)
  } catch (error) {
    if (error instanceof ApiError) return { error: publicError(error) }
    throw error
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function grantAdmin(
  _previous: AdminsState,
  form: FormData
): Promise<AdminsState> {
  void _previous
  await assertOrigin()
  const auth = await authorize()
  if ("error" in auth) return auth
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return { error: "Ingresá un email válido." }
  try {
    await gateway("/admin/admins", {
      accessToken: (await cookies()).get(ACCESS_COOKIE)?.value,
      body: { email },
    })
  } catch (error) {
    return { error: publicError(error) }
  }
  revalidatePath("/admins")
  return { notice: `${email} ahora es admin.` }
}

export async function revokeAdmin(
  _previous: AdminsState,
  form: FormData
): Promise<AdminsState> {
  void _previous
  await assertOrigin()
  const profile = await authorize()
  if ("error" in profile) return profile
  const userId = String(form.get("userId") ?? "")
  const reason = String(form.get("reason") ?? "").trim()
  if (!UUID.test(userId)) return { error: "No pudimos identificar al admin." }
  // El backend lo rechaza igual (ADMIN_CONFLICT_OF_INTEREST); acá se corta antes.
  if (userId === profile.id)
    return { error: "No podés revocarte el rol a vos mismo." }
  if (reason.length < 3 || reason.length > 500)
    return { error: "Escribí el motivo (entre 3 y 500 caracteres)." }
  try {
    await gateway(`/admin/admins/${userId}`, {
      method: "DELETE",
      accessToken: (await cookies()).get(ACCESS_COOKIE)?.value,
      body: { reason },
    })
  } catch (error) {
    return { error: publicError(error) }
  }
  // Sin aviso: la fila desaparece de la lista y con ella este formulario.
  revalidatePath("/admins")
  return {}
}
