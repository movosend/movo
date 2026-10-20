import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/users",
}))
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import type { AdminUserListItem } from "@movo/shared/src/types/admin-users"
import { UserSearch } from "./user-search"
import { UserRows } from "./user-table"

const user = (over: Partial<AdminUserListItem> = {}): AdminUserListItem => ({
  id: "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6",
  fullName: "Marcos Vera",
  email: "marcos.vera@gmail.com",
  phone: "+5493516124410",
  dni: "33812405",
  photoUrl: null,
  roles: ["sender", "carrier"],
  accountStatus: "active",
  bannedUntil: null,
  kycIdentity: "approved",
  kycLicense: "approved",
  createdAt: "2025-11-03T15:00:00.000Z",
  matchedBy: null,
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  nav.replace.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("buscador de usuarios", () => {
  it("escribe la búsqueda en la URL después de una pausa, no en cada tecla", () => {
    render(
      <UserSearch initialQuery="" label="26 usuarios · más recientes primero">
        <p>resultados</p>
      </UserSearch>
    )
    const input = screen.getByRole("searchbox", { name: "Buscar usuarios" })
    fireEvent.change(input, { target: { value: "mar" } })
    fireEvent.change(input, { target: { value: "marcos" } })
    expect(nav.replace).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(260)
    })
    expect(nav.replace).toHaveBeenCalledTimes(1)
    expect(nav.replace).toHaveBeenCalledWith("/users?q=marcos", {
      scroll: false,
    })
  })

  it("muestra el conteo del servidor y el botón de borrar limpia la URL", () => {
    render(
      <UserSearch initialQuery="marcos" label="1 resultado">
        <p>resultados</p>
      </UserSearch>
    )
    expect(screen.getByText("1 resultado")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Borrar búsqueda" }))
    expect(nav.replace).toHaveBeenCalledWith("/users", { scroll: false })
    expect(screen.getByRole("searchbox")).toHaveValue("")
  })
})

describe("resultados", () => {
  it("avisa por qué coincidió cuando no fue por nombre ni email", () => {
    render(<UserRows users={[user({ matchedBy: "dni" })]} query="33812405" />)
    expect(screen.getByText("Coincide por DNI")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Marcos Vera/ })).toHaveAttribute(
      "href",
      "/users/7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"
    )
  })

  it("marca la cuenta eliminada y la suspendida con fecha", () => {
    render(
      <UserRows
        users={[
          user({ id: "a", fullName: "Lorena Paz", accountStatus: "deleted" }),
          user({
            id: "b",
            fullName: "Hernán Molina",
            accountStatus: "banned",
            bannedUntil: "2026-11-02T12:00:00Z",
          }),
        ]}
        query=""
      />
    )
    expect(screen.getByText("Eliminada")).toBeInTheDocument()
    expect(screen.getByText("Suspendida · hasta 2 nov")).toBeInTheDocument()
  })

  it("sin coincidencias explica cómo buscar", () => {
    render(<UserRows users={[]} query="zzz" />)
    expect(screen.getByText("Nadie coincide con “zzz”")).toBeInTheDocument()
    expect(screen.getByText(/el DNI sin puntos/)).toBeInTheDocument()
  })
})
