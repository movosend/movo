#!/usr/bin/env bash
# Uso: ./capturar.sh M-14 [marco.png]
# Saca la captura del simulador en ejecución y la deja enmarcada en assets/capturas/CODIGO.png
set -euo pipefail
COD="${1:?Falta el código de captura (por ejemplo M-14)}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
DESTINO="$AQUI/../assets/capturas"
MARCO="${2:-$AQUI/marco-iphone.png}"
mkdir -p "$DESTINO"
TMP="$(mktemp -t movo-captura).png"
xcrun simctl io booted screenshot --type=png "$TMP"
if [ -f "$MARCO" ]; then
  python3 "$AQUI/enmarcar.py" "$TMP" "$DESTINO/$COD.png" --marco "$MARCO"
else
  echo "Sin marco ($MARCO): se guarda la captura sin enmarcar" >&2
  cp "$TMP" "$DESTINO/$COD.png"
fi
rm -f "$TMP"
echo "Guardada: $DESTINO/$COD.png"
