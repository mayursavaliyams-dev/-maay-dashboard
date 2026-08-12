/**
 * raw-journal — Stage 0b.1–0b.3. Run: node test/raw-journal.test.js
 *
 * @test:unit @test:failure @test:boundary @test:integration @test:regression
 *
 * WHAT IS BEING TESTED, AND WHY EACH ONE MATTERS
 *
 * This module is the only thing standing between an inbound byte and its
 * permanent loss. So the tests are weighted towards the failure paths rather
 * than the happy one: a journal that writes correctly when everything works and
 * silently drops a record when the disk is full has the failure profile of no
 * journal at all.
 *
 * The three claims that carry the most weight:
 *   · a poll that returned NOTHING still writes a record (absence is a fact)
 *   · a process killed mid-append is DETECTABLE on read, not silently trimmed
 *   · a divergence between the two disk copies is caught by the manifest
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');
const { RawJournal, readJournalFile, verifyManifest, istParts } = require(path.join(ROOT, 'raw-journal.js'));

const quiet = { warn() {}, error() {}, log() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ag-journal-'));

// 2026-07-31 09:15:00 IST  ==  2026-07-31T03:45:00Z
const T_0915 = Date.parse('2026-07-31T03:45:00Z');
const HOUR = 3600_000;

console.log('\nraw-journal\n');

/* ── 1 · construction refuses to degrade ─────────────────────────────────── */
console.log('1 · a journal that cannot journal is not constructed');
{
  let a = false, b = false;
  try { new RawJournal({ stream: 'x' }); } catch { a = true; }
  try { new RawJournal({ root: tmp() }); } catch { b = true; }
  ok(a, 'no root → refused (a journal with no home is not a journal)');
  ok(b, 'no stream → refused (an unnamed stream cannot be rebuilt from)');
}

/* ── 2 · raw bytes are stored verbatim ───────────────────────────────────── */
console.log('\n2 · the body is stored exactly as it arrived');
{
  const root = tmp();
  const j = new RawJournal({ root, stream: 'chain', writer: 'test', now: () => T_0915, log: quiet });

  const payload = '{"spot":24275.9,"strikes":[{"k":24300,"ce":{"ltp":120.15}}]}';
  const r = j.write({ kind: 'observation', source: '/api/options/chain?instrument=NIFTY', body: payload });
  ok(r.ok, 'the write reports success');

  const parsed = readJournalFile(r.file);
  ok(parsed.records.length === 1, 'one record on disk');
  ok(parsed.records[0].body === payload, 'the body is byte-identical to what was passed in');
  ok(parsed.records[0].enc === 'utf8', 'and is recorded as utf8');
  ok(parsed.records[0].len === Buffer.byteLength(payload), `the byte length is recorded (${parsed.records[0].len})`);

  // Binary — a websocket frame. Must survive without mangling.
  const bin = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0xfe]);
  const r2 = j.write({ kind: 'observation', source: 'ws:feed', body: bin });
  const p2 = readJournalFile(r2.file);
  const back = p2.records.find(x => x.seq === 2);
  ok(back.enc === 'base64', 'a binary frame is recorded as base64, not silently coerced to utf8');
  ok(Buffer.from(back.body, 'base64').equals(bin), 'and round-trips byte-for-byte');
}

/* ── 3 · absence is a record ──────────────────────────────────────────────
   The behaviour the existing capture path does NOT have: it skips the write
   when a snapshot is unchanged, which makes "no movement" and "not running"
   the same bytes on disk. */
console.log('\n3 · a poll that returned nothing still writes');
{
  const root = tmp();
  const j = new RawJournal({ root, stream: 'chain', now: () => T_0915, log: quiet });

  j.write({ kind: 'observation', source: 'u', body: 'x' });
  j.gap('u', 'HTTP 204, empty chain');
  j.error('u', 'ECONNREFUSED');

  const file = j._primary('2026-07-31', '09');
  const p = readJournalFile(file);
  ok(p.records.length === 3, 'three records: one observation, one gap, one error');
  ok(p.records[1].kind === 'gap' && p.records[1].body === null,
    'the gap is written with a null body — absence recorded, not fabricated as empty data');
  ok(p.records[1].note === 'HTTP 204, empty chain', 'and carries its reason');
  ok(p.records[2].kind === 'error' && p.records[2].note === 'ECONNREFUSED',
    'a failed call is a distinct kind from an empty one — error ≠ empty');
  ok(j.stats.gaps === 1 && j.stats.errors === 1, 'both are counted separately in stats');

  let threw = false;
  try { j.write({ kind: 'observation', source: 'u' }); } catch { threw = true; }
  ok(threw, 'an observation with no body is REFUSED — it would read as data later');
}

/* ── 4 · hourly roll and the self-describing header ──────────────────────── */
console.log('\n4 · hourly roll, self-describing header');
{
  const root = tmp();
  let t = T_0915;
  const j = new RawJournal({ root, stream: 'chain', writer: 'unit-test', now: () => t, log: quiet });

  j.write({ kind: 'observation', source: 'u', body: 'a' });
  const h09 = readJournalFile(j._primary('2026-07-31', '09')).header;
  ok(h09 && h09.format === 'antigravity/raw-journal', 'the first line is a header naming the format');
  ok(h09.formatVersion === 1 && h09.stream === 'chain' && h09.hourIST === '09',
    'the header names its version, stream and hour');
  ok(h09.writer === 'unit-test' && h09.recordShape && h09.recordShape.body.includes('unparsed'),
    'and describes the record shape — a reader five years on needs nothing else');

  t += HOUR;
  j.write({ kind: 'observation', source: 'u', body: 'b' });
  ok(fs.existsSync(j._primary('2026-07-31', '10')), 'crossing the hour opens a new file');
  ok(j.stats.rolls === 1, 'the roll is counted');
  ok(readJournalFile(j._primary('2026-07-31', '09')).records.length === 1,
    'the previous hour keeps its own records and is not reopened');

  // A restart inside the same hour must not write a second header.
  const j2 = new RawJournal({ root, stream: 'chain', now: () => t, log: quiet });
  j2.write({ kind: 'observation', source: 'u', body: 'c' });
  const p10 = readJournalFile(j2._primary('2026-07-31', '10'));
  const headerLines = fs.readFileSync(j2._primary('2026-07-31', '10'), 'utf8')
    .split('\n').filter(l => l.includes('"_hdr"')).length;
  ok(headerLines === 1, 'a restart within the same hour appends — it does NOT write a second header');
  ok(p10.records.length === 2, 'and both records are present');
}

/* ── 5 · the IST day boundary ─────────────────────────────────────────────
   A UTC date boundary falls at 05:30 IST. Using it would split the archive at
   a point that means nothing to anyone reading by session. */
console.log('\n5 · the day boundary is IST, not UTC');
{
  const beforeMidnightIST = Date.parse('2026-07-31T18:20:00Z');  // 23:50 IST on the 31st
  const afterMidnightIST = Date.parse('2026-07-31T18:40:00Z');   // 00:10 IST on the 1st
  ok(istParts(beforeMidnightIST).date === '2026-07-31', '23:50 IST is still the 31st');
  ok(istParts(afterMidnightIST).date === '2026-08-01', '00:10 IST is the 1st');
  const marketOpen = Date.parse('2026-07-31T03:45:00Z');
  ok(istParts(marketOpen).hour === '09' && istParts(marketOpen).date === '2026-07-31',
    'the 09:15 IST open lands in hour 09 of the same trading day');
}

/* ── 6 · truncation is detectable ────────────────────────────────────────── */
console.log('\n6 · a process killed mid-append is visible on read');
{
  const root = tmp();
  const j = new RawJournal({ root, stream: 'chain', now: () => T_0915, log: quiet });
  j.write({ kind: 'observation', source: 'u', body: 'one' });
  j.write({ kind: 'observation', source: 'u', body: 'two' });
  const file = j._primary('2026-07-31', '09');

  // Simulate the kill: append a partial line with no terminating newline.
  fs.appendFileSync(file, '{"seq":3,"t":178539,"kind":"observ');

  const p = readJournalFile(file);
  ok(p.records.length === 2, 'the two intact records are returned');
  ok(p.truncatedTail && p.truncatedTail.bytes > 0,
    `the partial final line is REPORTED as truncatedTail (${p.truncatedTail.bytes} bytes), not silently dropped`);
  ok(p.malformed.length === 0, 'and is not confused with a malformed line in the middle of the file');

  // A corrupt line that is NOT at the end is a different fact and reads as one.
  const root2 = tmp();
  const k = new RawJournal({ root: root2, stream: 'chain', now: () => T_0915, log: quiet });
  k.write({ kind: 'observation', source: 'u', body: 'a' });
  const f2 = k._primary('2026-07-31', '09');
  fs.appendFileSync(f2, 'NOT JSON\n');
  k.write({ kind: 'observation', source: 'u', body: 'b' });
  const p2 = readJournalFile(f2);
  ok(p2.malformed.length === 1 && p2.truncatedTail === null,
    'a corrupt line mid-file is reported as malformed, and truncatedTail stays null');
  ok(p2.records.length === 2, 'the records either side of it are still readable');
}

/* ── 7 · dual disk ───────────────────────────────────────────────────────── */
console.log('\n7 · the second copy');
{
  const root = tmp(), mirrorRoot = tmp();
  const j = new RawJournal({ root, mirrorRoot, stream: 'chain', now: () => T_0915, log: quiet });
  const r = j.write({ kind: 'observation', source: 'u', body: 'payload' });
  ok(r.mirrored === true, 'the write reports that it was mirrored');

  const a = fs.readFileSync(j._primary('2026-07-31', '09'), 'utf8');
  const b = fs.readFileSync(j._mirror('2026-07-31', '09'), 'utf8');
  ok(a === b, 'both copies are byte-identical');

  ok(j.status().mirrored === true, 'status reports mirroring is on');
  const single = new RawJournal({ root: tmp(), stream: 'chain', now: () => T_0915, log: quiet });
  single.write({ kind: 'observation', source: 'u', body: 'x' });
  ok(single.status().mirrored === false,
    'and reports FALSE when there is no mirror — a single copy is never assumed to be two');
}

/* ── 8 · manifest and verification ───────────────────────────────────────── */
console.log('\n8 · sealing and verification');
{
  const root = tmp(), mirrorRoot = tmp();
  let t = T_0915;
  const j = new RawJournal({ root, mirrorRoot, stream: 'chain', now: () => t, log: quiet });
  j.write({ kind: 'observation', source: 'u', body: 'a' });
  j.write({ kind: 'observation', source: 'u', body: 'b' });
  t += HOUR;
  j.write({ kind: 'observation', source: 'u', body: 'c' });   // rolls, sealing hour 09

  const mf = path.join(root, 'L0_journal', '_manifest', 'chain.jsonl');
  ok(fs.existsSync(mf), 'the roll sealed the finished hour into a manifest');
  const entry = JSON.parse(fs.readFileSync(mf, 'utf8').trim().split('\n')[0]);
  ok(entry.hourIST === '09' && entry.records === 2, 'the entry names the hour and its record count');
  ok(/^[0-9a-f]{64}$/.test(entry.sha256), 'and carries a SHA-256 of the file');
  ok(entry.mirrorAgrees === true, 'the mirror was hashed independently and agrees');

  const v = verifyManifest(root, 'chain');
  ok(v.checked === 1 && v.ok === 1 && v.mismatched.length === 0, 'verification passes against the sealed file');

  // Tamper and re-verify.
  fs.appendFileSync(path.join(root, entry.rel), '{"seq":99,"t":1,"kind":"observation","body":"forged"}\n');
  const v2 = verifyManifest(root, 'chain');
  ok(v2.mismatched.length === 1, 'a byte appended after sealing is caught as a mismatch');
  ok(v2.mismatched[0].sealed !== v2.mismatched[0].actual, 'and both hashes are reported so the divergence is inspectable');

  const v3 = verifyManifest(root, 'nosuchstream');
  ok(v3.checked === 0 && v3.mismatched.length === 0,
    'a stream with no manifest reports zero checked — not zero mismatches presented as a pass');
}

/* ── 9 · a diverged mirror is caught ─────────────────────────────────────── */
console.log('\n9 · a silently diverged mirror');
{
  const root = tmp(), mirrorRoot = tmp();
  let t = T_0915;
  const j = new RawJournal({ root, mirrorRoot, stream: 'chain', now: () => t, log: quiet });
  j.write({ kind: 'observation', source: 'u', body: 'a' });

  // Something writes to the mirror behind our back — the failure that makes
  // "three copies" mean "three files that might all differ".
  fs.appendFileSync(j._mirror('2026-07-31', '09'), '{"tampered":true}\n');

  const entry = j.seal('2026-07-31', '09');
  ok(entry.mirrorAgrees === false, 'sealing detects that the two copies no longer match');
  ok(entry.sha256 !== entry.mirrorSha256, 'and records both hashes rather than one');
}

/* ── 10 · a failed write is reported, never swallowed ────────────────────── */
console.log('\n10 · write failure surfaces');
{
  const root = tmp();
  const j = new RawJournal({ root, stream: 'chain', now: () => T_0915, log: quiet });
  j.write({ kind: 'observation', source: 'u', body: 'a' });      // opens the hour

  const real = fs.appendFileSync;
  fs.appendFileSync = () => { throw new Error('ENOSPC: no space left on device'); };
  let r;
  try { r = j.write({ kind: 'observation', source: 'u', body: 'b' }); }
  finally { fs.appendFileSync = real; }

  ok(r.ok === false, 'the caller is told the write FAILED — it does not return a cheerful success');
  ok(/ENOSPC/.test(r.error), 'and is given the reason');
  ok(j.stats.writeFailures === 1, 'the failure is counted in stats');
  ok(j.stats.records === 1, 'and the record count does NOT include the record that was never written');
}

/* ── 11 · mirror failure degrades, it does not destroy ───────────────────── */
console.log('\n11 · a full mirror disk must not cost the primary copy');
{
  const root = tmp(), mirrorRoot = tmp();
  const j = new RawJournal({ root, mirrorRoot, stream: 'chain', now: () => T_0915, log: quiet });
  j.write({ kind: 'observation', source: 'u', body: 'a' });

  const real = fs.appendFileSync;
  const primary = j._primary('2026-07-31', '09');
  fs.appendFileSync = (f, d) => {
    if (f === j._mirror('2026-07-31', '09')) throw new Error('ENOSPC');
    return real(f, d);
  };
  let r;
  try { r = j.write({ kind: 'observation', source: 'u', body: 'b' }); }
  finally { fs.appendFileSync = real; }

  ok(r.ok === true && r.mirrored === false,
    'the write succeeds and honestly reports that it was NOT mirrored');
  ok(j.stats.mirrorFailures === 1, 'the mirror failure is counted');
  ok(readJournalFile(primary).records.length === 2,
    'the primary copy has both records — a full second disk does not turn degradation into loss');
}

/* ── 12 · close seals the open hour ──────────────────────────────────────── */
console.log('\n12 · shutdown');
{
  const root = tmp();
  const j = new RawJournal({ root, stream: 'chain', now: () => T_0915, log: quiet });
  j.write({ kind: 'observation', source: 'u', body: 'a' });
  const e = j.close();
  ok(e && e.hourIST === '09', 'close() seals whatever hour was open');
  ok(verifyManifest(root, 'chain').ok === 1, 'and the sealed hash verifies');
  ok(j.close() === null, 'a second close is a no-op rather than a duplicate manifest entry');
}

console.log(`\n${n} assertions passed`);
