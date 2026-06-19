// Fetch NSE F&O bhavcopy (real option OHLC) for trading days, extract NIFTY CE/PE only.
// UDiFF format: https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTDIR = 'bt-data/bhav';
fs.mkdirSync(OUTDIR, { recursive: true });

function ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,''); }
function isWeekday(d){ const x=d.getUTCDay(); return x>=1 && x<=5; }

async function fetchDay(d){
  const stamp = ymd(d);
  const out = path.join(OUTDIR, `nifty-${stamp}.csv`);
  if (fs.existsSync(out)) return 'cached';
  const url = `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${stamp}_F_0000.csv.zip`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 });
    if (!r.ok) return 'holiday'; // 404 = non-trading day
    const buf = Buffer.from(await r.arrayBuffer());
    const zip = path.join(OUTDIR, `_${stamp}.zip`);
    fs.writeFileSync(zip, buf);
    // unzip (Windows tar/Expand or system unzip)
    try { execSync(`tar -xf "${zip}" -C "${OUTDIR}"`, { stdio: 'ignore' }); }
    catch { execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${OUTDIR}/_ex_${stamp}'"`, { stdio: 'ignore' }); }
    // find extracted csv
    let csv = fs.readdirSync(OUTDIR).find(f => f.includes(stamp) && f.endsWith('.csv'));
    if (!csv) { const ex = path.join(OUTDIR, `_ex_${stamp}`); if (fs.existsSync(ex)) csv = path.join(`_ex_${stamp}`, fs.readdirSync(ex).find(f=>f.endsWith('.csv'))); }
    if (!csv) { fs.rmSync(zip,{force:true}); return 'no-csv'; }
    const full = path.join(OUTDIR, csv);
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const nifty = lines.filter(l => /^[^,]*,[^,]*,FO,NSE,IDO,/.test(l) && /,NIFTY,/.test(l) && /,(CE|PE),/.test(l));
    fs.writeFileSync(out, nifty.join('\n'));
    // cleanup
    fs.rmSync(zip, { force: true }); fs.rmSync(full, { force: true });
    const exdir = path.join(OUTDIR, `_ex_${stamp}`); if (fs.existsSync(exdir)) fs.rmSync(exdir, { recursive: true, force: true });
    return `ok (${nifty.length} rows)`;
  } catch (e) { return 'err:' + e.message.slice(0,40); }
}

(async () => {
  const days = parseInt(process.argv[2] || 120);   // trading-day target
  const end = new Date('2026-06-17');
  let got = 0, tried = 0;
  for (let back = 0; got < days && back < days * 2.2; back++) {
    const d = new Date(end.getTime() - back * 86400000);
    if (!isWeekday(d)) continue;
    tried++;
    const res = await fetchDay(d);
    if (res.startsWith('ok') || res === 'cached') got++;
    if (tried % 10 === 0 || res.startsWith('ok')) process.stdout.write(`${ymd(d)}:${res}  `);
  }
  console.log(`\nDone — ${got} trading days cached in ${OUTDIR}/`);
})();
