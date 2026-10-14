import { shortenEmail } from "../src/lib/mp-connect-format";

describe("shortenEmail", () => {
  it("deja igual un email corto", () => {
    expect(shortenEmail("julieta.ramos@gmail.com")).toBe("julieta.ramos@gmail.com");
  });

  it("recorta la parte local larga y conserva el dominio", () => {
    expect(shortenEmail("test_user_7133831507754225491@testuser.com")).toBe("test_user_7133…@testuser.com");
  });

  it("sin @ recorta al final", () => {
    expect(shortenEmail("nickname_muy_largo_de_mp", 8)).toBe("nickname…");
  });
});
