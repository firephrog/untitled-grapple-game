'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.DIAG_LOG_DIR
  ? path.resolve(process.env.DIAG_LOG_DIR)
  : path.resolve(process.cwd(), 'logs');

const DIAG_FILE = process.env.DIAG_LOG_FILE
  ? path.resolve(process.env.DIAG_LOG_FILE)
  : path.join(LOG_DIR, 'diagnostics.log');

let _ready = false;

function ensureReady() {
  if (_ready) return;
  fs.mkdirSync(path.dirname(DIAG_FILE), { recursive: true });
  _ready = true;
}

function toIso(ts) {
  return new Date(ts || Date.now()).toISOString();
}

function writeDiagnostic(kind, fields = {}) {
  try {
    ensureReady();
    const line = JSON.stringify({
      ts: toIso(fields.ts),
      pid: process.pid,
      kind,
      ...fields,
    });
    fs.appendFileSync(DIAG_FILE, line + '\n', 'utf8');
  } catch (err) {
    // Avoid recursive logging failures.
    try {
      process.stderr.write('[DiagnosticsLogger] write failed: ' + (err && err.message ? err.message : String(err)) + '\n');
    } catch {}
  }
}

function getDiagnosticsPath() {
  return DIAG_FILE;
}

module.exports = {
  writeDiagnostic,
  getDiagnosticsPath,
};
