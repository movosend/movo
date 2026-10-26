#!/usr/bin/env bash
# Uso: ./capturar.sh M-14
# Saca la captura del simulador en ejecución y la guarda SIN marco en assets/capturas/CODIGO.png.
# La versión enmarcada se genera aparte, sin tocar el original: ./enmarcar_todas.py M-14
set -euo pipefail
COD="${1:?Falta el código de captura (por ejemplo M-14)}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
DESTINO="$AQUI/../assets/capturas"
mkdir -p "$DESTINO"
TMP="$(mktemp -t movo-captura).png"
xcrun simctl io booted screenshot --type=png "$TMP"
cp "$TMP" "$DESTINO/$COD.png"
rm -f "$TMP"
echo "Guardada: $DESTINO/$COD.png"
# Marco: solo las móviles (M-NN) y, si Pillow está disponible, se actualiza la enmarcada.
if [[ "$COD" == M-* ]]; then
  python3 "$AQUI/enmarcar_todas.py" "$COD" --forzar || echo "No se pudo enmarcar (falta Pillow?): usá /usr/bin/python3 enmarcar_todas.py $COD" >&2
fi
