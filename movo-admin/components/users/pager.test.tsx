import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

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

import { Pager, pageWindow } from "./pager"

afterEach(cleanup)

describe("paginador", () => {
  it("en modo links no usa botones: la primera página tiene 'anterior' deshabilitado como span", () => {
    render(
      <Pager
        page={1}
        pageSize={10}
        total={26}
        href={(n) => `/users?page=${n}`}
      />
    )
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(screen.getByLabelText("Página anterior")).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(screen.getByLabelText("Página siguiente")).toHaveAttribute(
      "href",
      "/users?page=2"
    )
    expect(screen.getByText("Mostrando 1–10 de 26")).toBeInTheDocument()
  })

  it("en modo botones avisa la página elegida", () => {
    const onChange = vi.fn()
    render(
      <Pager page={1} pageSize={5} total={12} size={30} onChange={onChange} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Página 3" }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it("con muchas páginas muestra una ventana con puntos suspensivos", () => {
    expect(pageWindow(5, 12)).toEqual([1, "…", 4, 5, 6, "…", 12])
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
  })
})
