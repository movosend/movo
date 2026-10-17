"use server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { gateway, publicError } from "@/lib/auth/api"
import { assertOrigin, requireAdmin } from "@/lib/auth/session"
import { ACCESS_COOKIE } from "@/lib/auth/policy"

export interface AdminsState {
  error?: string
  notice?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function grantAdmin(
  _previous: AdminsState,
  form: FormData
): Promise<AdminsState> {
  void _previous
  await assertOrigin()
  await requireAdmin(true, "/admins")
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
  const profile = await requireAdmin(true, "/admins")
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
  revalidatePath("/admins")
  return { notice: "Se revocó el rol de admin." }
}
