#!/usr/bin/env node
/**
 * MOVO-215 — ¿Cuánto dura de verdad un hold de Mercado Pago?
 *
 * Consulta cada hold registrado en `hold-watch.json` (lo arma la opción "w" de
 * `mp-spike-cli.js`) con `GET /v1/payments/:id` y agrega una línea por consulta
 * a `hold-expiry-log.jsonl`. Cuando MP deja de reportar un hold como
 * `authorized`, lo marca como cerrado y deja de consultarlo.
 *
 * Pensado para correr solo, sin menú, desde el Programador de tareas de Windows
 * o cron (ver HOLD-EXPIRY-MEASUREMENT.md). Sin dependencias: solo `fetch` de
 * Node 18+.
 *
 * El momento de la cancelación no sale de la hora de la consulta (eso solo
 * acota una ventana) sino de `date_last_updated` del pago, que MP actualiza
 * al cancelarlo. Las dos quedan en el log.
 *
 * Uso:
 *   node hold-expiry-watch.js            consulta los holds abiertos
 *   node hold-expiry-watch.js --report   solo imprime el resumen, sin consultar
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WATCH_PATH = path.join(__dirname, 'hold-watch.json');
const LOG_PATH = path.join(__dirname, 'hold-expiry-log.jsonl');
const MP_API_BASE = 'https://api.mercadopago.com';

function readWatch() {
  if (!fs.existsSync(WATCH_PATH)) {
    console.error('[error] No existe hold-watch.json. Creá un hold y registralo con la opción "w" de mp-spike-cli.js.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(WATCH_PATH, 'utf8'));
}

function readLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs
    .readFileSync(LOG_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function hoursBetween(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000;
}

async function poll(watch) {
  const now = new Date().toISOString();
  let changed = false;

  for (const hold of watch) {
    if (hold.closedAt) continue;

    let entry;
    try {
      const res = await fetch(`${MP_API_BASE}/v1/payments/${hold.paymentId}`, {
        headers: { Authorization: `Bearer ${hold.sellerAccessToken}` },
      });
      const body = await res.json();
      // Un error de MP también trae `status` (el código HTTP): no confundirlo con el del pago.
      const data = res.ok ? body : {};
      entry = {
        polledAt: now,
        paymentId: hold.paymentId,
        label: hold.label,
        httpStatus: res.status,
        status: data.status ?? null,
        statusDetail: data.status_detail ?? null,
        captured: data.captured ?? null,
        dateCreated: data.date_created ?? null,
        dateLastUpdated: data.date_last_updated ?? null,
        dateOfExpiration: data.date_of_expiration ?? null,
        moneyReleaseDate: data.money_release_date ?? null,
      };
      if (!res.ok) entry.error = body.message ?? body;
    } catch (err) {
      entry = { polledAt: now, paymentId: hold.paymentId, label: hold.label, error: String(err) };
    }

    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
    console.log(
      `${hold.paymentId} [${hold.label}] → ${entry.status ?? 'error'} / ${entry.statusDetail ?? entry.error ?? '-'}`
    );

    if (entry.status && entry.status !== 'authorized') {
      hold.closedAt = entry.dateLastUpdated ?? now;
      hold.closedDetectedAt = now;
      hold.finalStatus = entry.status;
      hold.finalStatusDetail = entry.statusDetail;
      changed = true;
      console.log(`   ⚠ dejó de estar authorized: ${entry.status} / ${entry.statusDetail} (date_last_updated ${entry.dateLastUpdated})`);
    }
  }

  if (changed) fs.writeFileSync(WATCH_PATH, JSON.stringify(watch, null, 2));
}

function report(watch) {
  const log = readLog();
  console.log('\nResumen (para pegar en MOVO-215):\n');
  console.log('| Hold | Medio | Creado | Cerrado (date_last_updated) | Horas | Estado final | Última consulta authorized | Primera consulta cerrado |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const hold of watch) {
    const entries = log.filter((e) => String(e.paymentId) === String(hold.paymentId));
    const lastAuthorized = entries.filter((e) => e.status === 'authorized').at(-1)?.polledAt ?? '-';
    const hours = hold.closedAt ? hoursBetween(hold.dateCreated, hold.closedAt).toFixed(1) : '(abierto)';
    console.log(
      `| ${hold.paymentId} | ${hold.label} (${hold.paymentMethodId}/${hold.paymentTypeId}) | ${hold.dateCreated} | ${hold.closedAt ?? '-'} | ${hours} | ${hold.finalStatus ? `${hold.finalStatus} / ${hold.finalStatusDetail}` : '-'} | ${lastAuthorized} | ${hold.closedDetectedAt ?? '-'} |`
    );
  }
}

async function main() {
  const watch = readWatch();
  if (!process.argv.includes('--report')) await poll(watch);
  report(watch);
}

main().catch((err) => {
  console.error('[excepción no controlada]', err);
  process.exit(1);
});
