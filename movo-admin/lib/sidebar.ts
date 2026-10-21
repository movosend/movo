import "server-only"
import { cookies } from "next/headers"

/** Estado guardado del sidebar (cookie `sidebar_state`); expandido si no hay valor. */
export async function sidebarDefaultOpen() {
  return (await cookies()).get("sidebar_state")?.value !== "false"
}
