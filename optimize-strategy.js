/**
 * STRATEGY OPTIMIZER
 * Tests dozens of parameter combinations and ranks by win rate × avg multiplier
 * Finds the best signal filters for SENSEX expiry day options
 */

require('dotenv').config();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });

function toYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getUTCFullYear() + '-' +
    String(x.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(x.getUTCDate()).padStart(2, '0');
}
function normCDF(x) {
  const a=[0.254829592,-0.284496736,1.421413741,-1.453152027,1.061405429], p=0.3275911, s=x<0?-1:1;
  x=Math.abs(x); const t=1/(1+p*x);
  const y=1-(((((a[4]*t+a[3])*t)+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x);
  return 0.5*(1+s*y);
}
function bs(S,K,T,r,iv,type) {
  if(T<0.00001) return Math.max(type==='CE'?S-K:K-S,0);
  const d1=(Math.log(S/K)+(r+0.5*iv*iv)*T)/(iv*Math.sqrt(T)), d2=d1-iv*Math.sqrt(T);
  return type==='CE'?S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2):K*Math.exp(-r*T)*normCDF(-d2)-S*normCDF(-d1);
}
function histVol(closes) {
  if(closes.length<3) return 0.18;
  const rets=[]; for(let i=1;i<closes.length;i++) rets.push(Math.log(closes[i]/closes[i-1]));
  const mean=rets.reduce((s,r)=>s+r,0)/rets.length;
  const v=rets.reduce((s,r)=>s+(r-mean)**2,0)/(rets.length-1);
  return Math.sqrt(v*252);
}

const HIGH_IMPACT_EVENTS = new Set([
  '2003-02-28','2004-02-03','2005-02-28','2006-02-28','2007-02-28',
  '2008-02-29','2009-02-16','2010-02-26','2011-02-28','2012-03-16',
  '2013-02-28','2014-07-10','2015-02-28','2016-02-29','2017-02-01',
  '2018-02-01','2019-02-01','2020-02-01','2021-02-01','2022-02-01',
  '2023-02-01','2024-02-01','2025-02-01','2026-02-01',
  '2004-05-13','2009-05-16','2014-05-16','2019-05-23','2024-06-04',
  '2020-03-27','2020-05-22','2022-05-04','2022-06-08','2022-08-05','2022-09-30',
  '2023-02-08','2023-04-06','2024-04-05','2024-06-07',
  '2020-03-23','2016-11-08','2019-09-20','2008-10-24','2013-08-16',
]);

const BSE_HOLIDAYS = new Set([
  '2003-01-26','2003-08-15','2003-12-25','2004-01-26','2004-08-15','2004-10-01','2004-11-12','2004-12-25',
  '2005-01-26','2005-03-25','2005-08-15','2005-11-01','2005-12-25','2006-01-26','2006-04-14','2006-08-15','2006-10-24','2006-12-25',
  '2007-01-26','2007-03-02','2007-04-06','2007-08-15','2007-11-09','2007-12-25','2008-01-26','2008-03-21','2008-08-15','2008-10-29','2008-12-25',
  '2009-01-26','2009-04-10','2009-08-15','2009-10-19','2009-12-25','2010-01-26','2010-03-01','2010-04-02','2010-08-15','2010-11-05','2010-12-25',
  '2011-01-26','2011-03-19','2011-04-14','2011-04-22','2011-08-15','2011-10-26','2011-12-25',
  '2012-01-26','2012-03-08','2012-04-06','2012-08-15','2012-11-13','2012-11-14','2012-12-25',
  '2013-01-26','2013-03-27','2013-03-29','2013-04-01','2013-08-15','2013-11-04','2013-12-25',
  '2014-01-14','2014-01-26','2014-02-27','2014-04-14','2014-04-18','2014-08-15','2014-10-03','2014-10-24','2014-12-25',
  '2015-01-26','2015-02-17','2015-03-06','2015-04-03','2015-04-14','2015-08-15','2015-09-17','2015-10-22','2015-11-12','2015-12-25',
  '2016-01-26','2016-03-07','2016-03-25','2016-04-14','2016-04-15','2016-08-15','2016-09-05','2016-10-11','2016-10-12','2016-10-30','2016-11-14','2016-12-25',
  '2017-01-26','2017-02-24','2017-03-13','2017-04-04','2017-04-14','2017-06-26','2017-08-15','2017-08-25','2017-10-02','2017-10-19','2017-10-20','2017-12-25',
  '2018-01-26','2018-02-13','2018-03-02','2018-03-29','2018-03-30','2018-04-02','2018-05-01','2018-08-15','2018-08-22','2018-09-20','2018-10-02','2018-11-07','2018-11-08','2018-11-21','2018-12-25',
  '2019-03-04','2019-03-21','2019-04-17','2019-04-19','2019-04-29','2019-05-01','2019-06-05','2019-08-12','2019-08-15','2019-09-02','2019-09-10','2019-10-02','2019-10-07','2019-10-08','2019-10-27','2019-10-28','2019-11-12','2019-12-25',
  '2020-02-21','2020-03-10','2020-04-02','2020-04-06','2020-04-10','2020-04-14','2020-05-01','2020-05-25','2020-08-03','2020-08-15','2020-11-16','2020-11-30','2020-12-25',
  '2021-01-26','2021-03-11','2021-03-29','2021-04-02','2021-04-14','2021-05-13','2021-07-21','2021-08-15','2021-09-10','2021-10-15','2021-11-04','2021-11-05','2021-11-19','2021-12-25',
  '2022-01-26','2022-03-01','2022-03-18','2022-04-14','2022-04-15','2022-05-03','2022-08-09','2022-08-15','2022-08-31','2022-10-05','2022-10-24','2022-10-26','2022-11-08',
  '2023-01-26','2023-03-07','2023-03-30','2023-04-04','2023-04-07','2023-04-14','2023-05-01','2023-06-28','2023-08-15','2023-09-19','2023-10-02','2023-10-24','2023-11-14','2023-11-27','2023-12-25',
  '2024-01-26','2024-03-08','2024-03-25','2024-03-29','2024-04-11','2024-04-17','2024-05-01','2024-05-20','2024-06-17','2024-07-17','2024-08-15','2024-10-02','2024-11-01','2024-11-15','2024-12-25',
  '2025-02-26','2025-03-14','2025-03-31','2025-04-10','2025-04-14','2025-04-18','2025-05-01','2025-08-15','2025-08-27','2025-10-02','2025-10-21','2025-10-22','2025-11-05','2025-12-25',
  '2026-01-26','2026-02-17','2026-03-03','2026-03-25','2026-04-03'
]);

function generateExpiries(count) {
  const expiries=[], cut=new Date('2024-10-28T00:00:00Z'), end=new Date();
  end.setUTCHours(0,0,0,0);
  const cursor=new Date(end);
  while(expiries.length<count) {
    const dow=cursor.getUTCDay(), isAfter=cursor>=cut, target=isAfter?2:5;
    if(dow===target) {
      const ymd=toYmd(cursor);
      if(!BSE_HOLIDAYS.has(ymd)) expiries.push(ymd);
      else { const p=new Date(cursor-86400000), py=toYmd(p), pd=p.getUTCDay(); if(!BSE_HOLIDAYS.has(py)&&pd!==0&&pd!==6) expiries.push(py); }
      cursor.setUTCDate(cursor.getUTCDate()-7);
    } else cursor.setUTCDate(cursor.getUTCDate()-1);
    if(cursor.getUTCFullYear()<2003) break;
  }
  return expiries.reverse();
}

// ── Signal with configurable params ──────────────────────────────
function getSignalV2(candle, prevClose, closes10, vol, date, p) {
  if(vol < p.minVol) return null;
  const {open,high,low,close} = candle;
  const range    = (high-low)/open*100;
  const body     = Math.abs(close-open)/open*100;
  const bodyRatio= range>0?body/range:0;
  const gapPct   = (open-prevClose)/prevClose*100;
  const absGap   = Math.abs(gapPct);
  const isBull   = close>=open;

  // New filter: prior streak — how many of last N days match signal direction
  const streak = closes10.slice(-p.streakLookback).reduce((cnt,c,i,arr)=>{
    if(i===0) return cnt;
    return cnt + (isBull ? (c>arr[i-1]?1:0) : (c<arr[i-1]?1:0));
  }, 0);
  if(p.streakMin > 0 && streak < p.streakMin) return null;

  // New filter: EMA alignment
  if(p.useEMA && closes10.length>=10) {
    const ema = closes10.slice(-10).reduce((s,c)=>s+c,0)/10;
    if(isBull && close < ema) return null;
    if(!isBull && close > ema) return null;
  }

  // New filter: vol expansion
  if(p.useVolExpansion) {
    const recentVol  = histVol(closes10.slice(-10));
    const priorVol   = histVol(closes10.slice(-20,-10));
    if(recentVol < priorVol * 0.9) return null;
  }

  const direction = isBull?'CALL':'PUT';

  if(HIGH_IMPACT_EVENTS.has(date) && bodyRatio>=p.eventBody && range>=p.eventRange)
    return { direction, strikeOffset: p.eventStrike, reason:'EVENT' };

  if(bodyRatio>=p.powerBody && range>=p.powerRange && absGap<=p.powerMaxGap)
    return { direction, strikeOffset: p.highStrike, reason:'POWER' };

  const gapAligned=(gapPct>1.0&&isBull)||(gapPct<-1.0&&!isBull);
  if(!p.noGapCont && gapAligned && bodyRatio>=p.gapBody && range>=p.gapRange)
    return { direction, strikeOffset: p.highStrike, reason:'GAP_CONT' };

  if(!p.noMedium && bodyRatio>=p.trendBody && range>=p.trendRange && absGap<=5)
    return { direction, strikeOffset: p.medStrike, reason:'TREND' };

  return null;
}

// ── Trade simulation ──────────────────────────────────────────────
function simulateTrade(candle, vol, signal, strikeOffset, slPct) {
  const {open,high,low,close} = candle;
  const r=0.065, T=6/(252*6.5), Tmid=3/(252*6.5);
  const atm = Math.round(open/100)*100;
  const isCE = signal==='CALL';
  const strike = isCE ? atm+strikeOffset*100 : atm-strikeOffset*100;
  const iv = Math.max(vol*1.7,0.30)*(1+strikeOffset*0.08);
  const entry = bs(open,strike,T,r,iv,isCE?'CE':'PE');
  if(entry<0.5) return null;

  // SL check
  const sqT=Math.sqrt(T), d1=(Math.log(open/strike)+(r+0.5*iv*iv)*T)/(iv*sqT);
  const delta=isCE?normCDF(d1):normCDF(-d1);
  const spotSLMove=entry*(slPct/100)/Math.max(delta,0.05);
  const spotSL=isCE?open-spotSLMove:open+spotSLMove;
  const slHit=isCE?low<=spotSL:high>=spotSL;
  if(slHit) return entry*(1-slPct/100)/entry; // multiplier

  // Trail
  const spotBest=isCE?high:low;
  const optBest=bs(spotBest,strike,Tmid,r,iv,isCE?'CE':'PE');
  let trailFloor=0;
  if(optBest>=entry*2.0) trailFloor=entry+(optBest-entry)*0.60;
  if(optBest>=entry*3.0) trailFloor=entry+(optBest-entry)*0.75;

  const intrinsic=Math.max(isCE?close-strike:strike-close,0.05);
  const exit=Math.max(intrinsic, trailFloor);
  return exit/entry;
}

// ── Run one parameter set ─────────────────────────────────────────
function runParams(allData, byDate, expiries, p) {
  let trades=0, wins=0, sumMult=0;
  for(const date of expiries) {
    const entry=byDate[date]; if(!entry) continue;
    const {idx,c:candle}=entry;
    const closes=allData.slice(Math.max(0,idx-25),idx).map(x=>x.close);
    if(closes.length<5) continue;
    const vol=histVol(closes.slice(-20));
    const prevClose=closes[closes.length-1];
    const sig=getSignalV2(candle,prevClose,closes,vol,date,p);
    if(!sig) continue;
    const mult=simulateTrade(candle,vol,sig.direction,sig.strikeOffset,p.slPct);
    if(mult===null) continue;
    trades++; sumMult+=mult;
    if(mult>1) wins++;
  }
  return { trades, wins, winRate: trades>0?wins/trades:0, avgMult: trades>0?sumMult/trades:0, score: trades>0?(wins/trades)*((sumMult/trades)):0 };
}

async function main() {
  const expiries = generateExpiries(1200);
  const fetchFrom = new Date(expiries[0]); fetchFrom.setDate(fetchFrom.getDate()-35);
  const fetchTo   = new Date(expiries[expiries.length-1]+'T00:00:00Z'); fetchTo.setUTCDate(fetchTo.getUTCDate()+2);

  console.error('Fetching data...');
  const raw = await yf.historical('^BSESN',{period1:toYmd(fetchFrom),period2:toYmd(fetchTo),interval:'1d'});
  raw.sort((a,b)=>new Date(a.date)-new Date(b.date));
  console.error('Got',raw.length,'candles');

  const byDate={};
  raw.forEach((c,i)=>{ byDate[toYmd(c.date)]={idx:i,c}; });

  // ── BASELINE ──────────────────────────────────────────────────
  const baseline = {
    minVol:0.12, powerBody:0.75, powerRange:1.2, powerMaxGap:3,
    gapBody:0.60, gapRange:1.0, trendBody:0.65, trendRange:0.9,
    eventBody:0.55, eventRange:1.0,
    highStrike:1, medStrike:0, eventStrike:2,
    noGapCont:false, noMedium:false,
    streakMin:0, streakLookback:3, useEMA:false, useVolExpansion:false,
    slPct:35
  };

  // ── PARAMETER GRID ────────────────────────────────────────────
  const configs = [
    // Label                 Params
    ['BASELINE',             {...baseline}],
    ['NO_MEDIUM',            {...baseline, noMedium:true}],
    ['NO_MEDIUM+NOGAPCONT',  {...baseline, noMedium:true, noGapCont:true}],
    ['STREAK1',              {...baseline, streakMin:1}],
    ['STREAK2',              {...baseline, streakMin:2}],
    ['STREAK1+NOMED',        {...baseline, streakMin:1, noMedium:true}],
    ['STREAK2+NOMED',        {...baseline, streakMin:2, noMedium:true}],
    ['EMA_FILTER',           {...baseline, useEMA:true}],
    ['EMA+NOMED',            {...baseline, useEMA:true, noMedium:true}],
    ['EMA+STREAK1',          {...baseline, useEMA:true, streakMin:1}],
    ['EMA+STREAK1+NOMED',    {...baseline, useEMA:true, streakMin:1, noMedium:true}],
    ['VOLEXP',               {...baseline, useVolExpansion:true}],
    ['VOLEXP+NOMED',         {...baseline, useVolExpansion:true, noMedium:true}],
    ['VOLEXP+EMA',           {...baseline, useVolExpansion:true, useEMA:true}],
    ['VOLEXP+EMA+STREAK1',   {...baseline, useVolExpansion:true, useEMA:true, streakMin:1}],
    ['VOLEXP+EMA+NOMED',     {...baseline, useVolExpansion:true, useEMA:true, noMedium:true}],
    ['HIGH_BODY_0.78',       {...baseline, powerBody:0.78}],
    ['HIGH_BODY_0.80',       {...baseline, powerBody:0.80}],
    ['HIGH_RANGE_1.3',       {...baseline, powerRange:1.3}],
    ['HIGH_RANGE_1.4',       {...baseline, powerRange:1.4}],
    ['HIGH_BODY+RANGE',      {...baseline, powerBody:0.78, powerRange:1.3}],
    ['TIGHT_ALL',            {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0}],
    ['TIGHT+STREAK1',        {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0,streakMin:1}],
    ['TIGHT+EMA',            {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0,useEMA:true}],
    ['TIGHT+EMA+STREAK1',    {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0,useEMA:true,streakMin:1}],
    ['TIGHT+EMA+STREAK2',    {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0,useEMA:true,streakMin:2}],
    ['TIGHT+VOLEXP+EMA',     {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0,useEMA:true,useVolExpansion:true}],
    ['TIGHT+VOLEXP+EMA+S1',  {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0,useEMA:true,useVolExpansion:true,streakMin:1}],
    ['MINVOL_0.14',          {...baseline, minVol:0.14}],
    ['MINVOL_0.14+NOMED',    {...baseline, minVol:0.14, noMedium:true}],
    ['MINVOL_0.14+EMA',      {...baseline, minVol:0.14, useEMA:true}],
    ['ALL_ATM',              {...baseline, highStrike:0, medStrike:0, eventStrike:1}],
    ['ALL_ATM+NOMED',        {...baseline, highStrike:0, medStrike:0, eventStrike:1, noMedium:true}],
    ['ALL_ATM+EMA+S1',       {...baseline, highStrike:0, medStrike:0, eventStrike:1, useEMA:true, streakMin:1}],
    ['BEST_GUESS',           {...baseline, powerBody:0.78,powerRange:1.3,gapBody:0.65,gapRange:1.1,trendBody:0.70,trendRange:1.0,useEMA:true,useVolExpansion:true,streakMin:1,highStrike:1,medStrike:0,eventStrike:2,minVol:0.13}],
    ['SL_25',                {...baseline, slPct:25}],
    ['SL_30',                {...baseline, slPct:30}],
    ['SL_40',                {...baseline, slPct:40}],
    ['SL_25+NOMED',          {...baseline, slPct:25, noMedium:true}],
    ['SL_25+EMA',            {...baseline, slPct:25, useEMA:true}],
  ];

  // ── RUN ALL ───────────────────────────────────────────────────
  const results = configs.map(([label, p]) => ({
    label, ...runParams(raw, byDate, expiries, p)
  }));

  // Sort by score (winRate × avgMult)
  results.sort((a,b) => b.score - a.score);

  // ── PRINT RESULTS ─────────────────────────────────────────────
  const pad = (s,n) => String(s).padEnd(n);
  const padL = (s,n) => String(s).padStart(n);

  console.log('\n' + '='.repeat(78));
  console.log('  STRATEGY OPTIMIZER — 1200 EXPIRY WEEKS (sorted by WinRate × AvgMult)');
  console.log('='.repeat(78));
  console.log(pad('Config',30) + padL('Trades',8) + padL('WinRate',10) + padL('AvgMult',10) + padL('Score',10));
  console.log('-'.repeat(78));

  for(const r of results) {
    const wr = (r.winRate*100).toFixed(1)+'%';
    const am = r.avgMult.toFixed(3)+'x';
    const sc = r.score.toFixed(3);
    const flag = r.winRate>=0.60?'  ← 60%+':r.winRate>=0.55?'  ← 55%+':'';
    console.log(pad(r.label,30)+padL(r.trades,8)+padL(wr,10)+padL(am,10)+padL(sc,10)+flag);
  }
  console.log('='.repeat(78));

  // Print top 5 detail
  console.log('\n  TOP 5 CONFIGS:');
  for(const r of results.slice(0,5)) {
    console.log(`  [${r.label}]  trades=${r.trades}  winRate=${(r.winRate*100).toFixed(1)}%  avgMult=${r.avgMult.toFixed(3)}x  score=${r.score.toFixed(3)}`);
  }
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
