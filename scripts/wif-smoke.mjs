#!/usr/bin/env node
/**
 * Call the staging Workload Identity smoke route and print one line per step.
 * ADMIN_SECRET is read from the environment and is never printed.
 * Tokens in an error string are replaced with "redacted".
 *
 *   read -rs ADMIN_SECRET && export ADMIN_SECRET
 *   npm run smoke:wif
 *
 * Optional: WIF_SMOKE_URL (default https://staging.luminarasuite.com/api/admin/wif-smoke).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'https://staging.luminarasuite.com/api/admin/wif-smoke';

export function formatSmokeLines(report) {
  const steps = Array.isArray(report?.steps) ? report.steps : [];
  const lines = steps.map((step) => {
    const name = typeof step?.step === 'string' ? step.step : 'step';
    const ms = Number.isInteger(step?.latencyMs) ? step.latencyMs : 0;
    const mark = step?.ok === true ? 'PASS' : 'FAIL';
    const error = step?.ok === true ? '' : ` ${sanitize(step?.error || 'failed')}`;
    return `${mark} ${name} ${ms}ms${error}`;
  });
  if (typeof report?.doc === 'string' && /^_smoke\/wif-\d+$/.test(report.doc)) lines.push(`doc ${report.doc}`);
  return lines;
}

export function sanitize(value) {
  const text = String(value ?? '');
  if (/bearer|eyJ|private key|-----|BEGIN /i.test(text)) return 'redacted';
  return text.slice(0, 120);
}

export async function main(env = process.env, fetchImpl = globalThis.fetch, write = console.log, writeErr = console.error) {
  const secret = String(env.ADMIN_SECRET || '');
  if (!secret.trim()) {
    writeErr('FAIL config: set ADMIN_SECRET in the environment. The value is not printed.');
    return 1;
  }
  const url = String(env.WIF_SMOKE_URL || DEFAULT_URL);
  const started = Date.now();
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-secret': secret },
      body: '{}',
    });
  } catch {
    writeErr(`FAIL request ${Date.now() - started}ms`);
    return 1;
  }
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  write(`wif smoke ${url} http ${response.status} ${Date.now() - started}ms`);
  const lines = formatSmokeLines(body);
  if (lines.length === 0) {
    const error = body && typeof body.error === 'string' ? sanitize(body.error) : 'no steps';
    writeErr(`FAIL http ${response.status} ${error}`);
    return 1;
  }
  for (const line of lines) write(line);
  const failed = response.status !== 200 || body?.ok !== true || lines.some((line) => line.startsWith('FAIL '));
  return failed ? 1 : 0;
}

function startedFromCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (startedFromCli()) {
  main().then((code) => {
    process.exit(code);
  }).catch(() => {
    console.error('FAIL request');
    process.exit(1);
  });
}
