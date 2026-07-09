/**
 * docker-context — guards what enters the Docker image. Run: node test/docker-context.test.js
 *
 * Migration C2-01.
 *
 * `Dockerfile:11` is `COPY . .`, so the ONLY thing standing between a secret (or 187 MB of
 * research data, or a mutable ledger) and an image layer is `.dockerignore`. A test that
 * merely greps `.dockerignore` for the string ".env" proves nothing — it would pass on a
 * typo'd pattern that matches nothing. So this suite re-implements Docker's ignore
 * semantics, recomputes the actual build context, and asserts on the RESULT.
 *
 * Two invariants:
 *   1. No secret enters the context.
 *   2. No mutable runtime state is baked into the image. `data/` holds the paper-trading
 *      ledger, open positions, forward-test records and `config-overrides.json` (which
 *      carries STRANGLE_ENGINE_ENABLED / STRANGLE_CAPITAL / AI_AGENTS_ENABLED). Baking it
 *      in means every rebuild resets the research evidence this platform exists to gather.
 *      Excluding it is only safe BECAUSE docker-compose bind-mounts it — so this suite
 *      asserts the mount too. The exclusion and the mount are one change, not two.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('docker-context (migration C2-01)');

const ROOT = path.join(__dirname, '..');
const dockerignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');

// ── Docker ignore semantics: a pattern matches a path or any of its leading dirs.
//    `*` does not cross a `/`.
const patterns = dockerignore
  .split(/\r?\n/).map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'));

const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
const rx = patterns.map((p) => new RegExp('^' + esc(p) + '$'));

function isIgnored(rel) {
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    if (rx.some((r) => r.test(parts.slice(0, i).join('/')))) return true;
  }
  return false;
}

// ── walk the real tree and build the context Docker would see ──
const context = [];
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (isIgnored(rel)) continue;
    if (e.isDirectory()) { walk(full); continue; }
    let size = 0;
    try { size = fs.statSync(full).size; } catch { continue; }
    context.push({ rel, size });
  }
})(ROOT);

const inContext = (p) => context.some((f) => f.rel === p || f.rel.startsWith(p + '/'));
const totalBytes = context.reduce((s, f) => s + f.size, 0);

ok(context.length > 0, `build context computed: ${context.length} files, ${(totalBytes / 1e6).toFixed(1)} MB`);

// ══ invariant 1: no secret enters the image ══
{
  ok(!inContext('.env'), 'C2-01: .env is excluded from the build context');
  for (const f of ['.env.example', '.env.selling.example']) {
    assert.ok(!inContext(f), `${f} must be excluded by the .env.* pattern`);
  }
  ok(true, 'C2-01: every .env.* variant is excluded');

  const envLike = context.filter((f) => /(^|\/)\.env/.test(f.rel));
  ok(envLike.length === 0, `C2-01: no .env-shaped file anywhere in the context (incl. backups/)`);

  // Scan every text file that WOULD be copied for a credential-shaped literal.
  const SECRET = /(eyJ[A-Za-z0-9_-]{20,}|access[_-]?token"?\s*[:=]\s*"[^"]{16,}|client[_-]?secret"?\s*[:=]\s*"[^"]{12,}|api[_-]?secret"?\s*[:=]\s*"[^"]{12,})/;
  const hits = [];
  for (const f of context) {
    if (f.size > 3e6) continue;
    if (!/\.(js|json|jsonl|txt|yml|yaml|sh|bat|html|csv)$/i.test(f.rel)) continue;
    let src;
    try { src = fs.readFileSync(path.join(ROOT, f.rel), 'utf8'); } catch { continue; }
    const m = src.match(SECRET);
    if (m) hits.push(`${f.rel} → ${m[0].slice(0, 30)}…`);
  }
  ok(hits.length === 0, `C2-01: no credential-shaped literal in the build context${hits.length ? '\n      ' + hits.join('\n      ') : ''}`);
}

// ══ invariant 2: no mutable runtime state, no research data, no backups ══
{
  ok(!inContext('data'), 'C2-01: data/ (paper ledger, open positions, config-overrides) is NOT baked into the image');
  ok(!inContext('data/config-overrides.json'), 'C2-01: engine on/off state is not frozen into an image layer');
  ok(!inContext('bt-data'), 'C2-01: bt-data/ (187 MB of research data) is excluded');
  ok(!inContext('backups'), 'C2-01: migration backups are excluded');
  ok(!inContext('SCREEENSHOTS'), 'C2-01: screenshots are excluded');
  ok(!inContext('exports'), 'C2-01: exports/ is excluded');
  ok(!inContext('node_modules') && !inContext('.git'), 'C2-01: node_modules and .git are excluded');
  ok(!inContext('test'), 'C2-01: tests are not part of the runtime image');
  ok(!inContext('deprecated') && !inContext('stock'), 'C2-01: archived trees are excluded');
}

// ══ the app must still be able to run: the things it NEEDS are present ══
{
  for (const f of ['server.js', 'package.json', 'instrument-registry.js', 'strike-resolver.js',
                   'option-analyzer.js', 'pop-seller.js', 'strangle-engine.js', 'charges.js',
                   'crash-analyzer.js', 'forward-test-logger.js']) {
    assert.ok(inContext(f), `${f} MUST be in the image`);
  }
  ok(true, 'C2-01: every module server.js requires at boot is still in the context');
  ok(inContext('public'), 'C2-01: public/ (21 dashboard pages) is in the image');
  ok(!inContext('public/designs') && !inContext('public/terminals'), 'C2-01: …but UI experiment folders are not');
}

// ══ the exclusion of data/ is only safe because compose mounts it ══
{
  ok(/COPY \. \./.test(dockerfile), 'C2-01: Dockerfile still uses `COPY . .` — .dockerignore is the only guard');
  ok(/\.\/data:\/app\/data/.test(compose),
    'C2-01: docker-compose bind-mounts ./data:/app/data — WITHOUT this, excluding data/ would lose all paper history');
  ok(/\.\/bt-data:\/app\/bt-data:ro/.test(compose), 'C2-01: bt-data is bind-mounted read-only');
  ok(/env_file/.test(compose) && /- \.env/.test(compose), 'C2-01: secrets arrive at runtime via env_file, not via a layer');
  ok(!/volumes:[\s\S]*?app-data:/.test(compose), 'C2-01: a NAMED volume is not used for data/ — an empty one would reset engine config');
  ok(/TRADE_MODE=paper/.test(compose), 'C2-01: compose pins TRADE_MODE=paper');
}

// ══ size: the image should not carry a research corpus ══
{
  ok(totalBytes < 40e6, `C2-01: build context is ${(totalBytes / 1e6).toFixed(1)} MB (was 237.7 MB before this migration)`);
  const biggest = context.slice().sort((a, b) => b.size - a.size)[0];
  ok(biggest.size < 5e6, `C2-01: largest single file in the context is ${(biggest.size / 1e6).toFixed(2)} MB (${biggest.rel})`);
}

console.log(`\n${pass} assertions passed`);
