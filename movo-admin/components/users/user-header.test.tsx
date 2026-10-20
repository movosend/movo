import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

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

import type { AdminUserProfile } from "@movo/shared/src/types/admin-users"
import { AccountBanner, UserHeader } from "./user-header"

const profile = (over: Partial<AdminUserProfile> = {}): AdminUserProfile => ({
  id: "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6",
  firstName: "Marcos",
  lastName: "Vera",
  fullName: "Marcos Vera",
  email: "marcos.vera@gmail.com",
  emailVerified: true,
  phone: "+5493516124410",
  phoneVerified: true,
  dni: "33812405",
  birthdate: "1988-04-18",
  photoUrl: null,
  createdAt: "2025-11-03T15:00:00.000Z",
  deletedAt: null,
  roles: [{ role: "sender", grantedAt: "2025-11-03T15:00:00.000Z" }],
  accountStatus: "active",
  bannedUntil: null,
  ...over,
})

afterEach(cleanup)

describe("cabecera de la ficha", () => {
  it("reserva el lugar de las acciones, deshabilitado y sin hacer nada (MOVO-36)", () => {
    render(
      <UserHeader user={profile()}>
        <div />
      </UserHeader>
    )
    const actions = screen.getByText("Acciones").closest("div")
    expect(actions).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByText("Próximamente")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Volver a usuarios/ })
    ).toHaveAttribute("href", "/users")
  })
})

describe("aviso de la cuenta", () => {
  it("una cuenta activa no lleva aviso", () => {
    const { container } = render(<AccountBanner user={profile()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("distingue suspendida, baneada y eliminada", () => {
    const { rerender } = render(
      <AccountBanner
        user={profile({
          accountStatus: "banned",
          bannedUntil: "2099-01-01T12:00:00Z",
        })}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      /Suspendida hasta el 1 ene 2099/
    )
    rerender(<AccountBanner user={profile({ accountStatus: "banned" })} />)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Baneada de forma permanente"
    )
    rerender(
      <AccountBanner
        user={profile({
          accountStatus: "deleted",
          deletedAt: "2026-10-17T15:00:00.000Z",
        })}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cuenta eliminada el 17 oct 2026"
    )
  })
})
