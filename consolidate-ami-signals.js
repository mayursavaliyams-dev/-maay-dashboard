// Consolidate ALL date-wise AmiBroker signal logs (data/ami-signals/ami-signals-<date>.jsonl)
// into ONE file: data/ami-signals-all.json  { generatedAt, totalSignals, dateRange, signals[] }.
// Dedups by record id, sorts by receivedAt.
//   CLI:    node consolidate-ami-signals.js
//   Server: require('./consolidate-ami-signals.js').consolidate()  (auto-run on a schedule)
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data', 'ami-signals');
const OUT = path.join(__dirname, 'data', 'ami-signals-all.json');

function consolidate() {
  const files = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter(f => /^ami-signals-.*\.jsonl$/.test(f)).sort()
    : [];
  const byId = new Map();
  let lines = 0, bad = 0;
  for (const f of files) {
    const txt = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const line of txt.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      lines++;
      try {
        const rec = JSON.parse(s);
        byId.set(rec.id || `${rec.receivedAt}|${rec.signal || ''}|${rec.strike || ''}`, rec);
      } catch (_) { bad++; }
    }
  }
  const signals = [...byId.values()].sort(
    (a, b) => (Number(a.receivedAt) || 0) - (Number(b.receivedAt) || 0)
  );
  const dates = signals.map(s => s.date).filter(Boolean);
  const out = {
    generatedAt: new Date().toISOString(),
    sourceFiles: files.length,
    totalSignals: signals.length,
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    signals,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  return { files: files.length, lines, bad, total: signals.length, out: OUT, dateRange: out.dateRange };
}

module.exports = { consolidate, OUT };

// CLI mode — print a summary.
if (require.main === module) {
  const r = consolidate();
  console.log('================ AmiBroker signal consolidation ================');
  console.log(`  source date-files : ${r.files}${r.files ? '' : ' — folder empty'}`);
  console.log(`  lines read        : ${r.lines}  (bad/skipped: ${r.bad})`);
  console.log(`  unique signals    : ${r.total}`);
  console.log(`  date range        : ${r.dateRange ? r.dateRange.from + ' → ' + r.dateRange.to : '—'}`);
  console.log(`  written           : ${path.relative(__dirname, r.out)}`);
  console.log('================================================================');
  if (!r.total) console.log('  (no AmiBroker signals yet — re-run after AFL starts pushing signals.)');
}
