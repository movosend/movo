import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";

describe("Página principal", () => {
  it("renderiza el mensaje de panel en construcción", () => {
    render(<Page />);
    expect(
      screen.getByText("Panel de administración en construcción"),
    ).toBeInTheDocument();
  });
});
