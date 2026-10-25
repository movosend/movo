#!/usr/bin/env python3
"""Documento de diagramas de transición de estados."""

DIAGRAMAS = [
    ("estados-envio", "Envío (`ShipmentStatus`)", "Ciclo de vida del envío, con los 11 estados del enumerado canónico. El grafo se genera leyendo `shipment-state-machine.ts`, la única fuente de verdad: toda transición que no figure acá es rechazada con `InvalidShipmentTransitionError` (409). `cancelled` y `disputed` son terminales en este módulo; la resolución de una disputa (MOVO-34) todavía no define a qué estado vuelve el envío, por lo que no se modela una transición inventada.", "services/movo-svc-shipments/src/domain/shipment-state-machine.ts"),
    ("estados-oferta", "Oferta (`OfferStatus`)", "Una oferta nace `pending` y termina en uno de siete estados terminales. `expired` no se persiste como transición: se deriva en lectura comparando `expires_at` con el reloj, de modo que no hace falta ningún proceso en segundo plano para vencer ofertas. Un rechazo no bloquea una oferta nueva del mismo transportista, que es una fila nueva.", "services/movo-svc-shipments/src/domain/offer-state-machine.ts"),
    ("estados-viaje", "Viaje (`TripStatus`)", "El transportista declara un viaje (`declared`) y lo inicia explícitamente; solo puede haber un viaje `active` por transportista, garantizado por un índice único parcial. Un viaje declarado vencido sin paquetes se cancela; uno activo sin paquetes ejecutables vence; uno activo con todos sus paquetes entregados se completa.", "services/movo-svc-shipments/src/repositories/trip-repository.ts"),
    ("estados-kyc", "Verificación de identidad (`KycStatus`)", "Estado de la verificación delegada en Didit.me. La misma máquina de estados rige la verificación de la licencia de conducir, con `verification_type = license`. Los estados intermedios de Didit no disparan ninguna transición. La revisión manual del equipo (`manual_review`) queda registrada, pero su resolución desde el panel es la historia MOVO-32, todavía pendiente.", "docs/kyc/state-diagram.md"),
    ("estados-cuenta", "Cuenta de usuario (`AccountStatus`)", "Estado de la cuenta. `suspended` y `banned` (inhabilitada) se aplican y levantan mediante sanciones registradas en un historial de solo agregar filas; una suspensión con fecha de fin vence sola. La baja (`deleted`) anonimiza la cuenta y solo es posible sin envíos activos ni disputas abiertas.", "services/movo-svc-users/prisma/schema.prisma"),
    ("estados-hold", "Reserva de fondos (`HoldStatus`)", "Una reserva (hold) autoriza el pago en la tarjeta del emisor sin capturarlo. Solo se captura al confirmarse la entrega, o parcialmente al cobrar una penalidad. Un índice único parcial garantiza un solo hold vivo por envío.", "services/movo-svc-payments/prisma/schema.prisma"),
    ("estados-liquidacion", "Liquidación (`SettlementStatus`)", "Resultado de capturar el hold. Una captura fallida se reintenta con espera creciente (5, 30 y 120 minutos) y, agotados los reintentos o ante una causa irrecuperable (cuenta del transportista rechazada, hold cancelado), escala a revisión manual.", "services/movo-svc-payments/prisma/schema.prisma"),
    ("estados-cuenta-corriente", "Movimiento de la cuenta corriente (`LedgerEntryStatus`)", "Estados de un movimiento de la cuenta corriente del usuario (penalidades, recargos, pagos voluntarios, ajustes). Las transiciones permitidas están declaradas en `user-ledger.service.ts`: de `settled` solo se sale anulando, y `voided` es terminal.", "services/movo-svc-payments/src/modules/user-ledger/user-ledger.service.ts"),
    ("estados-transferencia-receptor", "Transferencia de receptor (`ReceiverTransferStatus`)", "Solicitud para que otra persona reciba el envío (DD-038). Solo puede haber una solicitud pendiente por envío y una transferencia completada. Una solicitud pendiente se cancela si el receptor la retira o si empieza el handshake de entrega, y un barrido vence las que superan el plazo.", "services/movo-svc-shipments/prisma/schema.prisma"),
    ("estados-disputa", "Disputa (`DisputeStatus`)", "Una disputa se abre sobre un envío entregado o completado dentro de los 7 días (DD-054), o la abre el sistema ante una anomalía. Mientras está abierta, las contrapartes cargan sus descargos. El paso a `resolved` depende de la resolución del administrador (MOVO-34), todavía en backlog.", "services/movo-svc-shipments/prisma/schema.prisma"),
    ("estados-soporte", "Consulta de soporte (`SupportStatus`)", "Ciclo de una conversación con el equipo de soporte. Cuando el usuario escribe sobre una consulta resuelta, se reabre; sobre una que esperaba su respuesta, vuelve a abierta sin contar como reapertura.", "services/movo-svc-shipments/src/domain/support-rules.ts"),
    ("estados-reporte", "Reporte de usuario (`ReportStatus`)", "Estados de un reporte de moderación. Los estados `reviewed` y `dismissed` existen en el modelo; la pantalla del panel para revisar reportes no está implementada, por lo que hoy el equipo los consulta desde la ficha del usuario.", "services/movo-svc-users/prisma/schema.prisma"),
]


def main() -> None:
    out = ["# Diagramas de Transición de Estados\n"]
    out.append(
        "Los objetos de dominio de Movo con un ciclo de vida relevante se modelan como máquinas de estados explícitas: "
        "un enumerado de estados, un conjunto cerrado de transiciones válidas y el rechazo de cualquier otra. "
        "Esto evita estados imposibles y concentra las reglas del negocio en un único lugar por objeto. "
        "Cada diagrama sigue la notación de UML (estado inicial, transiciones con su disparador, estados terminales) "
        "y cita el archivo del que se obtuvo, que es la fuente de verdad.\n"
    )
    out.append("| Diagrama | Objeto | Estados |\n|--------|--------------------------------------|----------|")
    cuenta = {"estados-envio": 11, "estados-oferta": 9, "estados-viaje": 5, "estados-kyc": 6, "estados-cuenta": 4, "estados-hold": 6,
              "estados-liquidacion": 4, "estados-cuenta-corriente": 4, "estados-transferencia-receptor": 5, "estados-disputa": 2,
              "estados-soporte": 3, "estados-reporte": 3}
    for i, (ident, titulo, _, _) in enumerate(DIAGRAMAS, 1):
        out.append(f"| {i} | {titulo} | {cuenta[ident]} |")
    out.append("\n: Máquinas de estados del sistema.\n")
    for ident, titulo, texto, fuente in DIAGRAMAS:
        out.append(f"## {titulo}\n")
        out.append(texto + "\n")
        out.append(f"![Diagrama de estados: {titulo}.](diagrama:{ident}){{.borde .sin-corte}}\n")
        out.append(f"*Fuente:* `{fuente}`\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
