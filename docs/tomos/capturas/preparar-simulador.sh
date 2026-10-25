#!/usr/bin/env bash
# Prepara el simulador de iOS para tomar capturas uniformes.
set -euo pipefail
DISPOSITIVO="${1:-iPhone 16 Pro}"
xcrun simctl boot "$DISPOSITIVO" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$DISPOSITIVO" -b
# Barra de estado limpia y estable
xcrun simctl status_bar "$DISPOSITIVO" override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3 --operatorName ""
# Tema claro y ubicación en Córdoba capital
xcrun simctl ui "$DISPOSITIVO" appearance light
xcrun simctl location "$DISPOSITIVO" set -31.4201,-64.1888
echo "Simulador listo: $DISPOSITIVO"
