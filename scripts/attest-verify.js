#!/usr/bin/env node
/* attest-verify — does the running process contain the code in this tree?
   Phase 0. Exits 0 when they agree, non-zero when they do not.

   Usage:
     node scripts/attest-verify.js                     # against localhost:3000
     node scripts/attest-verify.js --url http://host:port [--path /api/attestation]
     node scripts/attest-verify.js --json

   HOW IT DECIDES
   --------------
   The process reports a hash it SEALED AT ITS OWN STARTUP, plus the per-file
   digests that went into it. This script re-reads those same files from the tree
   as it stands now and compares digest by digest. A difference means the file
   changed since the process loaded it — the process is running code that no
   longer exists in the tree.

   It compares per file rather than only the roll-up hash, because "the process
   is stale" is not actionable and "the process is stale in server.js and
   flatten.js" is.

   WHAT A ZERO EXIT DOES AND DOES NOT MEAN
   ---------------------------------------
   It means: every file this process loaded is byte-identical to the tree.
   It does NOT mean the process is healthy, or that the controls are active.
   Control status is printed separately and never folded into the exit code —
   a stale check and a safety check are different questions and merging them
   would make one of the two answers useless. */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const BASE = arg('--url', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const PATHNAME = arg('--path', '/api/attestation');
const AS_JSON = process.argv.includes('--json');

/* The endpoint is read-only and ungated in the proposed diff. Token support is
   here so that gating it later is a configuration change rather than a code
   change — and it is sent as a HEADER, never a query string, because
   control-auth's own audit log records the path and a token in `?ct=` lands in
   it. (That leak was found and fixed once already; see redactPath in
   control-auth.js. Not reintroducing it is cheaper than redacting it again.) */
const TOKEN = arg('--token', process.env.CONTROL_TOKEN || null);

const say = (s) => { if (!AS_JSON) console.log(s); };

(async () => {
  /* ── 1. ask the process what it is running ── */
  let report;
  try {
    const res = await fetch(BASE + PATHNAME, {
      signal: AbortSignal.timeout(8000),
      headers: TOKEN ? { 'x-control-token': TOKEN } : {},
    });
    if (!res.ok) {
      // A 404 here is itself the finding this whole phase exists for: the
      // endpoint is in the tree and not in the process.
      say(`FAIL — ${BASE}${PATHNAME} returned HTTP ${res.status}.`);
      if (res.status === 404) {
        say('       The attestation endpoint is not in the running process.');
        say('       Either the diff has not been applied, or the process has not restarted.');
      }
      process.exit(2);
    }
    report = await res.json();
  } catch (e) {
    say(`FAIL — could not reach ${BASE}${PATHNAME}: ${e.message}`);
    say('       A process that cannot be asked what it is running is not attested.');
    process.exit(2);
  }

  if (!report || report.schema !== 'attestation/1' || !Array.isArray(report.files)) {
    say('FAIL — the response is not an attestation/1 report.');
    process.exit(2);
  }

  /* ── 2. re-hash the same files from the tree, now ── */
  const drift = [];
  for (const f of report.files) {
    const abs = path.join(ROOT, f.rel);
    let now = null;
    try {
      now = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    } catch (e) {
      now = `UNREADABLE:${e.code || 'ERR'}`;
    }
    if (now !== f.sha256) {
      drift.push({
        file: f.rel,
        inProcess: String(f.sha256).slice(0, 12),
        inTree: String(now).slice(0, 12),
        gone: String(now).startsWith('UNREADABLE'),
      });
    }
  }

  /* ── 3. report ── */
  const cv = report.codeVersion || {};
  const result = {
    ok: drift.length === 0,
    url: BASE + PATHNAME,
    processPid: report.process && report.process.pid,
    processStartedAt: report.process && report.process.startedAt,
    sealedAt: cv.sealedAt,
    filesChecked: report.files.length,
    drift,
    controls: report.controls,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  say('══ ATTESTATION ══');
  say(`  endpoint        ${BASE}${PATHNAME}`);
  say(`  process pid     ${result.processPid}   started ${result.processStartedAt}`);
  say(`  sealed at       ${cv.sealedAt}`);
  say(`  code version    ${String(cv.hash || '').slice(0, 16)}   over ${cv.fileCount} loaded files`);
  say('');

  say('══ CONTROLS  (reported, never folded into the exit code) ══');
  for (const [name, c] of Object.entries(report.controls || {})) {
    const state = c.active === null ? 'UNEVALUABLE' : c.active ? 'ACTIVE' : 'NOT ACTIVE';
    say(`  ${name.padEnd(18)} configured=${String(c.configured).padEnd(5)} ${state}`);
    if (c.note) say(`  ${''.padEnd(18)} ${c.note}`);
    if (c.bypassing && c.bypassing.length) say(`  ${''.padEnd(18)} bypassing: ${c.bypassing.join(', ')}`);
  }
  say('');

  if (drift.length === 0) {
    say(`PASS — all ${report.files.length} loaded files are byte-identical to the tree.`);
    say('       (This says the code matches. It says nothing about whether it works.)');
    process.exit(0);
  }

  say(`FAIL — the running process is STALE. ${drift.length} of ${report.files.length} loaded files differ from the tree:`);
  say('');
  for (const d of drift.slice(0, 40)) {
    say(`  ${d.gone ? 'GONE   ' : 'CHANGED'}  ${d.file}`);
    say(`            in process ${d.inProcess}…   in tree ${d.inTree}…`);
  }
  if (drift.length > 40) say(`  … and ${drift.length - 40} more`);
  say('');
  say('       The process is running code that no longer exists in this tree.');
  say('       Any test you run against the tree is testing something else.');
  process.exit(1);
})();
