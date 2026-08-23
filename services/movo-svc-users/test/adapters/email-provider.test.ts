import { describe, it, expect } from "vitest";
import { buildEmailChangedNotice, buildOtpEmail } from "../../src/adapters/email-provider";

// Fix de review (PR #98, ldalmagro1): maskEmail() nunca enmascara el dominio y viajaba
// interpolado sin escapar en el HTML del aviso de cambio de email.
describe("email-provider templates (HTML escaping)", () => {
  it("buildEmailChangedNotice() escapa metacaracteres HTML del dominio (maskEmail() no lo enmascara)", () => {
    const { html } = buildEmailChangedNotice('a@evil.com"><script>alert(1)</script>');

    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;&gt;");
  });

  it("buildEmailChangedNotice() no rompe el mail para un email normal", () => {
    const { html, text } = buildEmailChangedNotice("juan.perez@gmail.com");

    expect(html).toContain("j********z@gmail.com");
    expect(text).toContain("j********z@gmail.com");
  });

  it("buildOtpEmail() interpola el código sin alterar su contenido", () => {
    const { html } = buildOtpEmail("482913");

    expect(html).toContain("482913");
  });
});
