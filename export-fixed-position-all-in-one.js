const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const POSITION_SIZE = Number(process.env.POSITION_SIZE || 2500);
const BROKERAGE_PER_ORDER = Number(process.env.BROKERAGE_PER_ORDER || 30);
const STARTING_CAPITAL = Number(process.env.STARTING_CAPITAL || 50000);
const RANGE_LABEL = process.env.RANGE_LABEL || '';
const OUTPUT_FILE = process.env.OUTPUT_FILE || '';

function parseInput(arg) {
  const [instrument, ...rest] = String(arg || '').split('=');
  const file = rest.join('=');
  if (!instrument || !file) return null;
  return [instrument.trim().toUpperCase(), file.trim()];
}

function defaultInputs() {
  return [
    ['NIFTY', 'backtest-daily-results-nifty.json'],
    ['BANKNIFTY', 'backtest-daily-results-banknifty.json'],
    ['SENSEX', 'backtest-daily-results-sensex.json']
  ];
}

const inputs = process.argv.slice(2).map(parseInput).filter(Boolean);
const reports = (inputs.length ? inputs : defaultInputs()).map(([instrument, file]) => {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing report for ${instrument}: ${fullPath}`);
  }
  return {
    instrument,
    file: fullPath,
    report: JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  };
});

function money(value) {
  return +((Number(value) || 0).toFixed(2));
}

function pct(value) {
  return +((Number(value) || 0).toFixed(2));
}

function sortTrades(trades) {
  return (trades || []).slice().sort((a, b) => {
    const date = String(a.date || '').localeCompare(String(b.date || ''));
    if (date !== 0) return date;
    return Number(a.entryTimestamp || 0) - Number(b.entryTimestamp || 0);
  });
}

function addToYear(map, row) {
  const year = String(row.Date || '').slice(0, 4) || 'UNKNOWN';
  const current = map.get(year) || {
    Year: year,
    Trades: 0,
    Wins: 0,
    Losses: 0,
    WinNetTotal: 0,
    LossNetTotalAbs: 0,
    GrossBeforeCharges: 0,
    Charges: 0,
    NetAfterCharges: 0
  };
  current.Trades += 1;
  if (row.ResultAfterCharges === 'WIN') {
    current.Wins += 1;
    current.WinNetTotal += row.NetPnl;
  } else {
    current.Losses += 1;
    current.LossNetTotalAbs += Math.abs(row.NetPnl);
  }
  current.GrossBeforeCharges += row.GrossPnl;
  current.Charges += row.Charges;
  current.NetAfterCharges += row.NetPnl;
  map.set(year, current);
}

function computeRiskRewardRatio(winNetTotal, lossNetTotalAbs, wins, losses) {
  const avgWin = wins > 0 ? winNetTotal / wins : 0;
  const avgLossAbs = losses > 0 ? lossNetTotalAbs / losses : 0;
  if (avgLossAbs <= 0) return 0;
  return +((avgWin / avgLossAbs).toFixed(3));
}

function buildReport({ instrument, report }) {
  const chargePerTrade = BROKERAGE_PER_ORDER * 2;
  let equity = STARTING_CAPITAL;
  let peak = STARTING_CAPITAL;
  let maxDrawdownPct = 0;
  let grossBeforeCharges = 0;
  let totalCharges = 0;
  let netAfterCharges = 0;
  let winsAfterCharges = 0;
  let winNetTotal = 0;
  let lossNetTotalAbs = 0;

  const yearMap = new Map();
  const dailyMap = new Map();

  const tradeRows = sortTrades(report.trades).map((trade, index) => {
    const multiplier = Number(trade.multiplier || 0);
    const startEquity = equity;
    const grossPnl = money(POSITION_SIZE * (multiplier - 1));
    const charges = money(chargePerTrade);
    const netPnl = money(grossPnl - charges);
    equity = money(equity + netPnl);
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);

    grossBeforeCharges += grossPnl;
    totalCharges += charges;
    netAfterCharges += netPnl;
    if (netPnl > 0) {
      winsAfterCharges += 1;
      winNetTotal += netPnl;
    } else {
      lossNetTotalAbs += Math.abs(netPnl);
    }

    const row = {
      Instrument: instrument,
      TradeNo: index + 1,
      Date: trade.date || '',
      Weekday: trade.weekday || '',
      Type: trade.type || '',
      ResultAfterCharges: netPnl > 0 ? 'WIN' : 'LOSS',
      RawResult: trade.win ? 'WIN' : 'LOSS',
      Reason: trade.reason || '',
      EntryTime: trade.entryTimestamp || '',
      ExitTime: trade.exitTimestamp || '',
      EntryPrice: money(trade.entryPrice),
      ExitPrice: money(trade.exitPrice),
      Multiplier: +multiplier.toFixed(3),
      PositionSize: money(POSITION_SIZE),
      GrossPnl: grossPnl,
      Charges: charges,
      NetPnl: netPnl,
      ReturnPct: pct((netPnl / POSITION_SIZE) * 100),
      NetPctOfPosition: pct((netPnl / POSITION_SIZE) * 100),
      StartEquity: money(startEquity),
      EndEquity: money(equity),
      DrawdownPct: pct(drawdownPct)
    };

    addToYear(yearMap, row);

    const daily = dailyMap.get(row.Date) || {
      Instrument: instrument,
      Date: row.Date,
      Weekday: row.Weekday,
      Status: 'TRADED',
      Trades: 0,
      WinsAfterCharges: 0,
      LossesAfterCharges: 0,
      WinNetTotal: 0,
      LossNetTotalAbs: 0,
      GrossBeforeCharges: 0,
      Charges: 0,
      NetAfterCharges: 0,
      BestMultiplier: 0
    };
    daily.Trades += 1;
    if (row.ResultAfterCharges === 'WIN') {
      daily.WinsAfterCharges += 1;
      daily.WinNetTotal += row.NetPnl;
    } else {
      daily.LossesAfterCharges += 1;
      daily.LossNetTotalAbs += Math.abs(row.NetPnl);
    }
    daily.GrossBeforeCharges += row.GrossPnl;
    daily.Charges += row.Charges;
    daily.NetAfterCharges += row.NetPnl;
    daily.BestMultiplier = Math.max(daily.BestMultiplier, row.Multiplier);
    dailyMap.set(row.Date, daily);

    return row;
  });

  const dailyRows = [];
  const seenDates = new Set();
  for (const day of report.expirySummaries || []) {
    const existing = dailyMap.get(day.date);
    seenDates.add(day.date);
    if (existing) {
      dailyRows.push({
        Instrument: existing.Instrument,
        Date: existing.Date,
        Weekday: existing.Weekday,
        Status: existing.Status,
        Trades: existing.Trades,
        WinsAfterCharges: existing.WinsAfterCharges,
        LossesAfterCharges: existing.LossesAfterCharges,
        GrossBeforeCharges: money(existing.GrossBeforeCharges),
        Charges: money(existing.Charges),
        NetAfterCharges: money(existing.NetAfterCharges),
        BestMultiplier: +Number(existing.BestMultiplier || 0).toFixed(3),
        ReturnPct: pct((existing.NetAfterCharges / POSITION_SIZE) * 100),
        RiskRewardRatio: computeRiskRewardRatio(
          existing.WinNetTotal,
          existing.LossNetTotalAbs,
          existing.WinsAfterCharges,
          existing.LossesAfterCharges
        )
      });
    } else {
      dailyRows.push({
        Instrument: instrument,
        Date: day.date || '',
        Weekday: day.weekday || '',
        Status: day.skipReason || 'NO_TRADE',
        Trades: 0,
        WinsAfterCharges: 0,
        LossesAfterCharges: 0,
        GrossBeforeCharges: 0,
        Charges: 0,
        NetAfterCharges: 0,
        BestMultiplier: money(day.bestMultiplier || 0),
        ReturnPct: 0,
        RiskRewardRatio: 0
      });
    }
  }
  for (const [date, existing] of dailyMap.entries()) {
    if (seenDates.has(date)) continue;
    dailyRows.push({
      Instrument: existing.Instrument,
      Date: existing.Date,
      Weekday: existing.Weekday,
      Status: existing.Status,
      Trades: existing.Trades,
      WinsAfterCharges: existing.WinsAfterCharges,
      LossesAfterCharges: existing.LossesAfterCharges,
      GrossBeforeCharges: money(existing.GrossBeforeCharges),
      Charges: money(existing.Charges),
      NetAfterCharges: money(existing.NetAfterCharges),
      BestMultiplier: +Number(existing.BestMultiplier || 0).toFixed(3),
      ReturnPct: pct((existing.NetAfterCharges / POSITION_SIZE) * 100),
      RiskRewardRatio: computeRiskRewardRatio(
        existing.WinNetTotal,
        existing.LossNetTotalAbs,
        existing.WinsAfterCharges,
        existing.LossesAfterCharges
      )
    });
  }
  dailyRows.sort((a, b) => String(a.Date || '').localeCompare(String(b.Date || '')));

  const yearlyRows = Array.from(yearMap.values()).sort((a, b) => String(a.Year).localeCompare(String(b.Year))).map(row => ({
    Instrument: instrument,
    Year: row.Year,
    Trades: row.Trades,
    WinsAfterCharges: row.Wins,
    LossesAfterCharges: row.Losses,
    AccuracyAfterCharges: row.Trades ? pct((row.Wins / row.Trades) * 100) : 0,
    GrossBeforeCharges: money(row.GrossBeforeCharges),
    Charges: money(row.Charges),
    NetAfterCharges: money(row.NetAfterCharges),
    ReturnPct: pct((row.NetAfterCharges / STARTING_CAPITAL) * 100),
    NetPctOfCapital: pct((row.NetAfterCharges / STARTING_CAPITAL) * 100),
    AvgNetPctPerTrade: row.Trades ? pct((row.NetAfterCharges / (POSITION_SIZE * row.Trades)) * 100) : 0,
    RiskRewardRatio: computeRiskRewardRatio(row.WinNetTotal, row.LossNetTotalAbs, row.Wins, row.Losses)
  }));

  const trades = tradeRows.length;
  const summary = {
    Instrument: instrument,
    Range: RANGE_LABEL || inferRange(report),
    DaysTested: report.totalExpiries || 0,
    DaysWithTrades: report.expiriesWithTrades || 0,
    Trades: trades,
    PositionSize: money(POSITION_SIZE),
    StartingCapital: money(STARTING_CAPITAL),
    BrokeragePerOrder: money(BROKERAGE_PER_ORDER),
    ChargesPerTrade: money(chargePerTrade),
    GrossBeforeCharges: money(grossBeforeCharges),
    Charges: money(totalCharges),
    NetAfterCharges: money(netAfterCharges),
    ReturnPct: pct((netAfterCharges / STARTING_CAPITAL) * 100),
    NetPctOfCapital: pct((netAfterCharges / STARTING_CAPITAL) * 100),
    AvgNetPctPerTrade: trades ? pct((netAfterCharges / (POSITION_SIZE * trades)) * 100) : 0,
    AccuracyAfterCharges: trades ? pct((winsAfterCharges / trades) * 100) : 0,
    RiskRewardRatio: computeRiskRewardRatio(winNetTotal, lossNetTotalAbs, winsAfterCharges, trades - winsAfterCharges),
    RawWinRate: report.stats?.winRate || 0,
    AvgMultiplier: report.stats?.avgMultiplier || 0,
    MaxMultiplier: report.stats?.maxMultiplier || 0,
    MaxDrawdownPct: pct(maxDrawdownPct),
    NoSpotDataDays: report.skipped?.noSpotData || 0,
    NoSignalDays: report.skipped?.noSignal || 0,
    FetchErrorDays: report.skipped?.fetchError || 0
  };

  return { summary, yearlyRows, dailyRows, tradeRows };
}

function inferRange(report) {
  const dates = (report.expirySummaries || []).map(d => d.date).filter(Boolean).sort();
  if (!dates.length) return '';
  return `${dates[0]} to ${dates[dates.length - 1]}`;
}

function sheetName(name) {
  return String(name).replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31);
}

function sheetFromObjects(rows) {
  const data = rows.length ? rows : [{ Note: 'No rows' }];
  const ws = XLSX.utils.json_to_sheet(data);
  const headers = Object.keys(data[0] || {});
  ws['!cols'] = headers.map(header => {
    const max = data.reduce((current, row) => Math.max(current, String(row[header] ?? '').length), header.length);
    return { wch: Math.min(Math.max(max + 2, 10), 34) };
  });
  applyFormats(ws, headers, data.length);
  return ws;
}

function applyFormats(ws, headers, rowCount) {
  const moneyColumns = new Set([
    'PositionSize', 'StartingCapital', 'BrokeragePerOrder', 'ChargesPerTrade',
    'GrossBeforeCharges', 'Charges', 'NetAfterCharges', 'GrossPnl', 'NetPnl',
    'StartEquity', 'EndEquity', 'EntryPrice', 'ExitPrice'
  ]);
  const pctColumns = new Set([
    'NetPctOfCapital', 'AvgNetPctPerTrade', 'AccuracyAfterCharges',
    'RawWinRate', 'MaxDrawdownPct', 'DrawdownPct', 'NetPctOfPosition', 'ReturnPct'
  ]);
  const multColumns = new Set(['AvgMultiplier', 'MaxMultiplier', 'BestMultiplier', 'Multiplier', 'RiskRewardRatio']);

  for (let c = 0; c < headers.length; c++) {
    const header = headers[c];
    let format = '';
    if (moneyColumns.has(header)) format = '"Rs "#,##0.00';
    else if (pctColumns.has(header)) format = '0.00"%"';
    else if (multColumns.has(header)) format = '0.000"x"';
    if (!format) continue;

    for (let r = 2; r <= rowCount + 1; r++) {
      const cell = XLSX.utils.encode_cell({ r: r - 1, c });
      if (ws[cell] && typeof ws[cell].v === 'number') ws[cell].z = format;
    }
  }
}

function main() {
  const built = reports.map(buildReport);
  const summaries = built.map(item => item.summary).sort((a, b) => b.NetAfterCharges - a.NetAfterCharges);
  const best = summaries[0] || {};
  const allYearly = built.flatMap(item => item.yearlyRows);
  const allDaily = built.flatMap(item => item.dailyRows).sort((a, b) => {
    const date = String(a.Date || '').localeCompare(String(b.Date || ''));
    if (date !== 0) return date;
    return String(a.Instrument || '').localeCompare(String(b.Instrument || ''));
  });
  const allTrades = built.flatMap(item => item.tradeRows).sort((a, b) => {
    const date = String(a.Date || '').localeCompare(String(b.Date || ''));
    if (date !== 0) return date;
    const instrument = String(a.Instrument || '').localeCompare(String(b.Instrument || ''));
    if (instrument !== 0) return instrument;
    return Number(a.TradeNo || 0) - Number(b.TradeNo || 0);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromObjects([best]), 'Best Result');
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(summaries), 'All Summary');
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(allYearly), 'All Yearly');
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(allDaily), 'All Daily');
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(allTrades), 'All Trades');

  for (let i = 0; i < built.length; i++) {
    const instrument = reports[i].instrument;
    XLSX.utils.book_append_sheet(wb, sheetFromObjects([built[i].summary]), sheetName(`${instrument} Summary`));
    XLSX.utils.book_append_sheet(wb, sheetFromObjects(built[i].yearlyRows), sheetName(`${instrument} Yearly`));
    XLSX.utils.book_append_sheet(wb, sheetFromObjects(built[i].dailyRows), sheetName(`${instrument} Daily`));
    XLSX.utils.book_append_sheet(wb, sheetFromObjects(built[i].tradeRows), sheetName(`${instrument} Trades`));
  }

  const outDir = path.resolve('exports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(OUTPUT_FILE || path.join(outDir, 'ALL-IN-ONE-fixed-position-backtest-profit-WITH-CHARGES.xlsx'));
  XLSX.writeFile(wb, outPath);

  console.table(summaries.map(row => ({
    Instrument: row.Instrument,
    Days: row.DaysTested,
    Trades: row.Trades,
    GrossBeforeCharges: row.GrossBeforeCharges,
    Charges: row.Charges,
    NetAfterCharges: row.NetAfterCharges,
    NetPctOfCapital: row.NetPctOfCapital
  })));
  console.log(outPath);
}

main();
