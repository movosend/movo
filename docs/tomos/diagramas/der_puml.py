#!/usr/bin/env python3
"""Genera los DER (PlantUML) de cada servicio a partir de su schema.prisma.

Escribe los .puml en el directorio indicado por DIAG_GEN (build/generados); build.py los compila
con el tema común. Las claves y relaciones salen del esquema real, no se dibujan a mano.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "herramientas"))
import prisma_modelo as pm  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
SALIDA = Path(os.environ.get("DIAG_GEN", Path(__file__).parent / "_generados"))
MAX_COLS = 8

# servicio -> [(id del diagrama, título, [modelos])]
GRUPOS = {
    "users": [
        ("der-users-cuenta", "Cuenta, roles, direcciones y vehículo", ["User", "UserRoleGrant", "Address", "DeviceKey", "VehicleProfile"]),
        ("der-users-verificacion", "Verificación de identidad, licencia y sanciones", ["KycVerification", "DriversLicense", "AccountSanction"]),
        ("der-users-notificaciones", "Notificaciones y recorridos", ["PushToken", "NotificationPreference", "NotificationCategoryPreference", "UserTour"]),
        ("der-users-moderacion", "Reportes y bloqueos entre usuarios", ["UserBlock", "UserReport", "UserReportEntry", "UserReportPhoto"]),
    ],
    "shipments": [
        ("der-shipments-envios", "Envíos, ofertas, eventos y calificaciones", ["Shipment", "ShipmentEvent", "ShipmentPhoto", "Offer", "Rating"]),
        ("der-shipments-custodia", "Viajes, custodia y seguimiento", ["Trip", "HandshakeEvent", "PickupEvidence", "ReceiverTransferRequest", "CarrierPosition"]),
        ("der-shipments-chat", "Chat del envío", ["ChatMessage", "ChatParticipantState", "ChatReport", "UserDisplayName"]),
        ("der-shipments-soporte", "Soporte", ["SupportConversation", "SupportMessage", "SupportAttachment", "SupportParticipantState"]),
        ("der-shipments-disputas", "Disputas", ["Dispute", "DisputeStatement", "DisputePhoto"]),
    ],
    "payments": [
        ("der-payments-cuentas", "Cuentas de cobro, tarjetas y pago de saldo", ["CarrierMpAccount", "PayerCustomer", "SavedCard", "BalancePaymentAttempt"]),
        ("der-payments-holds", "Reservas, liquidaciones, eventos y cuenta corriente", ["Hold", "Settlement", "MpWebhookNotification", "PaymentProviderEvent", "UserLedgerEntry"]),
    ],
    "admin": [("der-admin", "Administración", ["AuditLog", "AdminUserNote"])],
}


def entidad(m: pm.Modelo, completa: bool) -> str:
    cols = m.columnas
    pk = [c for c in cols if c.pk]
    fk = [c for c in cols if c.fk and not c.pk]
    otras = [c for c in cols if not c.pk and not c.fk]
    destacadas = [c for c in otras if c.nombre in ("status", "created_at")] + [c for c in otras if c.unica and c.nombre not in ("status", "created_at")]
    resto = [c for c in otras if c not in destacadas]
    elegidas = pk + fk + destacadas + resto if completa else pk
    visibles = elegidas[:MAX_COLS] if completa else elegidas
    out = [f'entity "{m.tabla}" as {m.nombre} {{']
    for c in [x for x in visibles if x.pk]:
        out.append(f"  * {c.nombre} : {c.tipo} <<PK>>")
    resto_vis = [x for x in visibles if not x.pk]
    if resto_vis:
        out.append("  --")
    for c in resto_vis:
        marca = " <<FK>>" if c.fk else ""
        out.append(f"  {'*' if c.obligatoria else ''} {c.nombre} : {c.tipo}{marca}".replace("   ", "  ", 1))
    ocultas = len(cols) - len(visibles)
    if completa and ocultas > 0:
        out.append(f"  .. +{ocultas} columnas ..")
    out.append("}")
    return "\n".join(out)


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    for servicio, grupos in GRUPOS.items():
        modelos, _ = pm.leer(REPO / "services" / f"movo-svc-{servicio}" / "prisma" / "schema.prisma")
        mapa = pm.por_nombre(modelos)
        for ident, _, nombres in grupos:
            lineas = [f"@startuml {ident}", "hide circle", "skinparam linetype ortho"]
            incluidos = set(nombres)
            externos = {c.fk for n in nombres for c in mapa[n].columnas if c.fk and c.fk not in incluidos}
            for n in nombres:
                lineas.append(entidad(mapa[n], True))
            for n in sorted(externos):
                lineas.append(entidad(mapa[n], False))
            for n in nombres:
                for c in mapa[n].columnas:
                    if c.fk:
                        lineas.append(f"{n} }}o--{'o|' if not c.obligatoria else '||'} {c.fk}")
            lineas.append("@enduml")
            (SALIDA / f"{ident}.puml").write_text("\n".join(lineas) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
