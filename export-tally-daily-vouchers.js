const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const inputPath = process.env.TALLY_SOURCE_XLSX ? path.resolve(process.env.TALLY_SOURCE_XLSX) : '';
const outDir = path.resolve('exports');
const outPath = path.join(outDir, 'tally-daily-index-profit-loss-vouchers.xml');

if (inputPath && !fs.existsSync(inputPath)) {
  console.error(`Input workbook not found: ${inputPath}`);
  process.exit(1);
}
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const COMPANY_NAME = process.env.TALLY_COMPANY || '';
const CAPITAL_LEDGER = process.env.TALLY_CAPITAL_LEDGER || 'Backtest Capital';
const BROKERAGE_LEDGER = process.env.TALLY_BROKERAGE_LEDGER || 'Backtest Brokerage Charges';
const VOUCHER_TYPE = process.env.TALLY_VOUCHER_TYPE || 'Journal';
const NOTIONAL_PER_TRADE = Number(process.env.TALLY_NOTIONAL_PER_TRADE || 2500);
const CHARGE_PER_TRADE = Number(process.env.TALLY_CHARGE_PER_TRADE || 0);

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function tallyDate(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function ledgerXml(name, parent) {
  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<LEDGER NAME="${xml(name)}" ACTION="Create">`,
    `<NAME>${xml(name)}</NAME>`,
    `<PARENT>${xml(parent)}</PARENT>`,
    '<ISBILLWISEON>No</ISBILLWISEON>',
    '<ISCOSTCENTRESON>No</ISCOSTCENTRESON>',
    '</LEDGER>',
    '</TALLYMESSAGE>'
  ].join('');
}

function ledgerEntry(name, amount) {
  const isDebit = amount < 0;
  return [
    '<ALLLEDGERENTRIES.LIST>',
    `<LEDGERNAME>${xml(name)}</LEDGERNAME>`,
    `<ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
    `<AMOUNT>${money(amount).toFixed(2)}</AMOUNT>`,
    '</ALLLEDGERENTRIES.LIST>'
  ].join('');
}

function voucherXml(voucher) {
  const entries = [];
  const pnlLedger = `${voucher.instrument} Trading Profit Loss`;

  if (voucher.grossPnl > 0) {
    entries.push(ledgerEntry(CAPITAL_LEDGER, -voucher.netPnl));
    if (voucher.charges > 0) entries.push(ledgerEntry(BROKERAGE_LEDGER, -voucher.charges));
    entries.push(ledgerEntry(pnlLedger, voucher.grossPnl));
  } else {
    entries.push(ledgerEntry(pnlLedger, voucher.grossPnl));
    if (voucher.charges > 0) entries.push(ledgerEntry(BROKERAGE_LEDGER, -voucher.charges));
    entries.push(ledgerEntry(CAPITAL_LEDGER, Math.abs(voucher.grossPnl) + voucher.charges));
  }

  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<VOUCHER VCHTYPE="${xml(VOUCHER_TYPE)}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `<DATE>${tallyDate(voucher.date)}</DATE>`,
    `<VOUCHERTYPENAME>${xml(VOUCHER_TYPE)}</VOUCHERTYPENAME>`,
    `<VOUCHERNUMBER>${xml(voucher.voucherNo)}</VOUCHERNUMBER>`,
    `<NARRATION>${xml(voucher.narration)}</NARRATION>`,
    ...entries,
    '</VOUCHER>',
    '</TALLYMESSAGE>'
  ].join('');
}

const grouped = new Map();

function addGroupedTrade(instrument, date, grossPnl, charges) {
  if (!instrument || !date) return;
  const key = `${date}|${instrument}`;
  if (!grouped.has(key)) {
    grouped.set(key, {
      date,
      instrument,
      trades: 0,
      grossPnl: 0,
      charges: 0,
      netPnl: 0
    });
  }
  const bucket = grouped.get(key);
  bucket.trades += 1;
  bucket.grossPnl += money(grossPnl);
  bucket.charges += money(charges);
  bucket.netPnl += money(grossPnl) - money(charges);
}

if (inputPath) {
  const wb = XLSX.readFile(inputPath);
  const sheet = wb.Sheets['ALL DATE WISE'];
  if (!sheet) {
    console.error('Sheet "ALL DATE WISE" not found in source workbook.');
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  for (const row of rows) {
    addGroupedTrade(
      String(row.Instrument || '').trim(),
      String(row.Date || '').trim(),
      Number(row.GrossPnl) || 0,
      Number(row.TotalCharges) || 0
    );
  }
} else {
  const jsonInputs = [
    ['NIFTY', 'backtest-daily-results-nifty.json'],
    ['SENSEX', 'backtest-daily-results-sensex.json'],
    ['BANKNIFTY', 'backtest-daily-results-banknifty.json']
  ];

  for (const [instrument, file] of jsonInputs) {
    if (!fs.existsSync(file)) continue;
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const trade of report.trades || []) {
      const grossPnl = NOTIONAL_PER_TRADE * ((Number(trade.pnlPct) || 0) / 100);
      addGroupedTrade(instrument, trade.date, grossPnl, CHARGE_PER_TRADE);
    }
  }
}

const vouchers = Array.from(grouped.values())
  .sort((a, b) => a.date.localeCompare(b.date) || a.instrument.localeCompare(b.instrument))
  .map((v, index) => ({
    ...v,
    grossPnl: money(v.grossPnl),
    charges: money(v.charges),
    netPnl: money(v.netPnl),
    voucherNo: `BT-${String(index + 1).padStart(5, '0')}`,
    narration: `${v.instrument} daily backtest P/L, ${v.trades} trade(s), gross ${money(v.grossPnl)}, charges ${money(v.charges)}, net ${money(v.netPnl)}`
  }))
  .filter(v => v.grossPnl !== 0 || v.charges !== 0);

const ledgerNames = new Set([CAPITAL_LEDGER, BROKERAGE_LEDGER]);
for (const instrument of ['NIFTY', 'SENSEX', 'BANKNIFTY']) {
  ledgerNames.add(`${instrument} Trading Profit Loss`);
}

const messages = [];
messages.push(ledgerXml(CAPITAL_LEDGER, 'Capital Account'));
messages.push(ledgerXml(BROKERAGE_LEDGER, 'Indirect Expenses'));
messages.push(ledgerXml('NIFTY Trading Profit Loss', 'Direct Incomes'));
messages.push(ledgerXml('SENSEX Trading Profit Loss', 'Direct Incomes'));
messages.push(ledgerXml('BANKNIFTY Trading Profit Loss', 'Direct Incomes'));
for (const voucher of vouchers) messages.push(voucherXml(voucher));

const companyBlock = COMPANY_NAME
  ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xml(COMPANY_NAME)}</SVCURRENTCOMPANY></STATICVARIABLES>`
  : '';

const envelope = [
  '<ENVELOPE>',
  '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
  '<BODY><IMPORTDATA>',
  `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${companyBlock}</REQUESTDESC>`,
  '<REQUESTDATA>',
  ...messages,
  '</REQUESTDATA>',
  '</IMPORTDATA></BODY>',
  '</ENVELOPE>'
].join('');

fs.writeFileSync(outPath, envelope, 'utf8');

const summary = vouchers.reduce((acc, v) => {
  acc.vouchers += 1;
  acc.grossPnl += v.grossPnl;
  acc.charges += v.charges;
  acc.netPnl += v.netPnl;
  return acc;
}, { vouchers: 0, grossPnl: 0, charges: 0, netPnl: 0 });

console.log(outPath);
console.log(JSON.stringify({
  vouchers: summary.vouchers,
  grossPnl: money(summary.grossPnl),
  charges: money(summary.charges),
  netPnl: money(summary.netPnl)
}, null, 2));
