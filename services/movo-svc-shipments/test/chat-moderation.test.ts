import { describe, it, expect } from "vitest";
import { moderateChatText } from "../src/domain/chat-moderation";

describe("moderateChatText (MOVO-26)", () => {
  it("tapa con asteriscos del mismo largo y conserva el resto del mensaje", () => {
    expect(moderateChatText("sos un pelotudo, no llegás nunca")).toEqual({
      text: "sos un ********, no llegás nunca",
      masked: true,
    });
  });

  it("un mensaje limpio queda idéntico y sin marcar", () => {
    const text = "Hola, ya salgo para el punto de retiro. ¿Estás en casa?";
    expect(moderateChatText(text)).toEqual({ text, masked: false });
  });

  it("detecta frases completas antes que la palabra suelta", () => {
    expect(moderateChatText("andate a la mierda, hijo de puta").text).toBe("andate a la mierda, **** ** ****");
    expect(moderateChatText("La Concha De Tu Madre").text).toBe("** ****** ** ** *****");
  });

  it.each([
    ["PELOTUDO", "********"],
    ["pelotudo", "********"],
    ["pelótudo", "********"],
    ["peloooootudo", "************"],
    ["put4", "****"],
    ["put@", "****"],
    ["pu7a!", "****!"],
    ["h.d.p", "h.d.p"],
  ])("evasiones comunes: %s", (input, expected) => {
    expect(moderateChatText(input).text).toBe(expected);
  });

  it.each([
    "El paquete está en la computadora",
    "Voy a comprar un pijama para el regalo",
    "El envío está retrasado, perdón",
    "Disputa abierta por el repartidor",
    "Soy de Puerto Madryn",
    "reputación del transportista",
    "boludo, qué calor hace",
    "Qué mierda de tránsito",
  ])("no toca texto legítimo ni palabrotas comunes: %s", (text) => {
    expect(moderateChatText(text)).toEqual({ text, masked: false });
  });

  it("tapa varias palabras ofensivas y mantiene espacios y signos", () => {
    expect(moderateChatText("¡Forro! Sos un idiota.").text).toBe("¡*****! Sos un ******.");
  });

  it("no tapa 'foro' (palabra legítima) pero sí 'forro', también con letras repetidas", () => {
    expect(moderateChatText("Pasé por el foro, hay varios foros")).toEqual({ text: "Pasé por el foro, hay varios foros", masked: false });
    expect(moderateChatText("sos un forro")).toEqual({ text: "sos un *****", masked: true });
    expect(moderateChatText("sos un forrrro")).toEqual({ text: "sos un *******", masked: true });
    expect(moderateChatText("puuuta madre")).toMatchObject({ masked: true });
  });
});
