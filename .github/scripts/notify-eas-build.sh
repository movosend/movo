#!/usr/bin/env bash
# Avisa por Telegram el resultado de un build de EAS (lo usa mobile-eas.yml).
#
# Entrada (variables de entorno):
#   MODE        dev | testflight
#   PLATFORM    ios | android
#   TAG         nombre del tag que disparó el workflow
#   JOB_STATUS  success | failure | cancelled (${{ job.status }})
#   RUN_URL     link a la ejecución del workflow
#   LOG_FILE    log de `eas build`, de donde se saca el link a la página del build
#   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
#   DRY_RUN     si está seteado, imprime el mensaje en vez de enviarlo
#
# Sin los secrets de Telegram no hace nada (exit 0): un aviso que no se puede mandar
# nunca tiene que romper un build.
set -euo pipefail

if [ -z "${DRY_RUN:-}" ] && { [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; }; then
  echo "Sin secrets de Telegram: se omite el aviso."
  exit 0
fi

case "$PLATFORM" in
  ios) label="iOS"; device="iPhone" ;;
  android) label="Android"; device="Android" ;;
  *) label="$PLATFORM"; device="dispositivo" ;;
esac

# Una sola página de build por job; el log puede repetir el mismo link varias veces.
link=""
if [ -f "${LOG_FILE:-}" ]; then
  link="$(grep -oE 'https://expo\.dev/accounts/[^ ]+/builds/[0-9a-f-]+' "$LOG_FILE" | sort -u | head -1 || true)"
fi

if [ "$JOB_STATUS" = "success" ]; then
  if [ "$MODE" = "testflight" ]; then
    text="$(printf 'Build de TestFlight (%s) listo y enviado a Apple: %s\n\n%s\n\nApple lo procesa unos 10 minutos y después llega a TestFlight.' "$label" "$TAG" "$link")"
  else
    text="$(printf 'Development build de %s listo: %s\n\n%s\n\nAbrí el link desde tu %s para instalarlo.' "$label" "$TAG" "$link" "$device")"
  fi
else
  what="Development build"
  [ "$MODE" = "testflight" ] && what="Build de TestFlight"
  state="falló"
  [ "$JOB_STATUS" = "cancelled" ] && state="se canceló"
  text="$(printf '%s de %s %s: %s\n\nBuild: %s\nWorkflow: %s' "$what" "$label" "$state" "$TAG" "${link:-sin link}" "$RUN_URL")"
fi

if [ -n "${DRY_RUN:-}" ]; then
  printf '%s\n' "$text"
  exit 0
fi

curl -sS --fail-with-body -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${text}" > /dev/null
