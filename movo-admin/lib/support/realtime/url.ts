/** El ticket solo puede abrir un WebSocket en el gateway configurado. */
export function isTrustedSupportSocketUrl(
  socketUrl: string,
  gatewayUrl: string,
  development: boolean
): boolean {
  try {
    const socket = new URL(socketUrl)
    const gateway = new URL(gatewayUrl)
    const protocol = gateway.protocol === "https:" ? "wss:" : "ws:"
    if (
      gateway.protocol !== "https:" &&
      !(development && gateway.protocol === "http:")
    )
      return false
    return (
      socket.protocol === protocol &&
      socket.host === gateway.host &&
      !socket.username &&
      !socket.password
    )
  } catch {
    return false
  }
}
