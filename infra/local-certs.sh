#!/usr/bin/env bash
#
# Genera un certificado self-signed para levantar el proxy nginx en local
# (docker-compose.local.yml) sin depender de Certbot/Let's Encrypt, que
# necesita un dominio público real. Solo para desarrollo: el navegador va
# a marcar el cert como no confiable, eso es esperado.
#
# Correrlo una vez desde infra/: ./local-certs.sh

set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${API_DOMAIN:-localhost}"
OUT_DIR=".local-certs/live/${DOMAIN}"

mkdir -p "$OUT_DIR" ".local-certs/webroot"

openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "${OUT_DIR}/privkey.pem" \
  -out "${OUT_DIR}/fullchain.pem" \
  -subj "/CN=${DOMAIN}"

echo "==> Cert self-signed generado en infra/.local-certs/live/${DOMAIN}/"
