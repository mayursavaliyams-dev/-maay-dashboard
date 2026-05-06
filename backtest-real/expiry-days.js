const INDIA_HOLIDAYS_APPROX = new Set([
  '2022-01-26', '2022-03-01', '2022-03-18', '2022-04-14', '2022-04-15',
  '2022-05-03', '2022-08-09', '2022-08-15', '2022-08-31', '2022-10-05',
  '2022-10-24', '2022-10-26', '2022-11-08',
  '2023-01-26', '2023-03-07', '2023-03-30', '2023-04-04', '2023-04-07',
  '2023-04-14', '2023-05-01', '2023-06-28', '2023-08-15', '2023-09-19',
  '2023-10-02', '2023-10-24', '2023-11-14', '2023-11-27', '2023-12-25',
  '2024-01-26', '2024-03-08', '2024-03-25', '2024-03-29', '2024-04-11',
  '2024-04-17', '2024-05-01', '2024-05-20', '2024-06-17', '2024-07-17',
  '2024-08-15', '2024-10-02', '2024-11-01', '2024-11-15', '2024-12-25',
  '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14',
  '2025-04-18', '2025-05-01', '2025-08-15', '2025-08-27', '2025-10-02',
  '2025-10-21', '2025-10-22', '2025-11-05', '2025-12-25',
  '2026-01-26', '2026-02-17', '2026-03-03', '2026-03-25', '2026-04-03'
]);

function toYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Day-of-week constants for clarity. JS Date.getUTCDay(): Sun=0..Sat=6.
const DOW_TUE = 2, DOW_WED = 3, DOW_THU = 4, DOW_FRI = 5;
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const NIFTY_TUESDAY_CUTOVER = '2025-09-02';
const BANKNIFTY_WEDNESDAY_CUTOVER = '2023-09-04';

/**
 * Walks backwards from endDate, picking expiry days for the given instrument.
 *
 * Modes:
 *   fridayOnly:true                           → Friday only, stops at cutover (BSE pre-2024-10-28 era)
 *   thursdayOnly:true (or fixedDow:DOW_THU)   → Thursday only across all history (NSE NIFTY weekly)
 *   default (no flags)                        → SENSEX auto-cutover (Friday→Tuesday after cutoverDate)
 */
function resolveInstrumentDow(instrument, cursor, sensexCutover) {
  const s = String(instrument || 'SENSEX').toUpperCase();
  const ts = cursor.getTime();

  if (s === 'NIFTY') {
    return ts >= new Date(`${NIFTY_TUESDAY_CUTOVER}T00:00:00Z`).getTime() ? DOW_TUE : DOW_THU;
  }

  if (s === 'BANKNIFTY' || s === 'BANK' || s === 'NIFTYBANK') {
    return ts >= new Date(`${BANKNIFTY_WEDNESDAY_CUTOVER}T00:00:00Z`).getTime() ? DOW_WED : DOW_THU;
  }

  return ts >= sensexCutover.getTime() ? DOW_TUE : DOW_FRI;
}

function eraForDow({ instrument, lockedDow, targetDow, isAfterCutover }) {
  const s = String(instrument || 'SENSEX').toUpperCase();
  if (lockedDow === DOW_TUE) return 'tuesday-only';
  if (lockedDow === DOW_WED) return 'wednesday-only';
  if (lockedDow === DOW_THU) return 'thursday-only';
  if (lockedDow === DOW_FRI) return 'friday-only';
  if (s === 'NIFTY') return targetDow === DOW_TUE ? 'nifty-tuesday' : 'nifty-thursday';
  if (s === 'BANKNIFTY' || s === 'BANK' || s === 'NIFTYBANK') return targetDow === DOW_WED ? 'banknifty-wednesday' : 'banknifty-thursday';
  return isAfterCutover ? 'post-cutover' : 'pre-cutover';
}

function generateExpiryDays({ count, cutoverDate, endDate, fridayOnly = false, thursdayOnly = false, fixedDow = null, instrument = 'SENSEX' }) {
  const expiries = [];
  const cutover = new Date(`${cutoverDate}T00:00:00Z`);
  const end = endDate ? new Date(`${endDate}T00:00:00Z`) : new Date();

  // Walk backwards from end date until we have `count` expiry days.
  const cursor = new Date(end.getTime());
  cursor.setUTCHours(0, 0, 0, 0);

  // Resolve the fixed day-of-week if any of the convenience flags are set.
  const lockedDow = fixedDow != null ? fixedDow
                  : thursdayOnly      ? DOW_THU
                  : fridayOnly        ? DOW_FRI
                                       : null;

  while (expiries.length < count) {
    const dow = cursor.getUTCDay();
    const isAfterCutover = cursor.getTime() >= cutover.getTime();

    // Friday-only runs must skip post-cutover dates: BSE delisted the
    // Friday weekly contract on the cutover date, so Dhan has no
    // option chains to fetch there. Jump straight to the last
    // pre-cutover trading day instead of walking day-by-day.
    if (fridayOnly && isAfterCutover) {
      cursor.setTime(cutover.getTime() - 86400000);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }

    // Pick target day-of-week:
    //   - explicit lockedDow (Thursday for NIFTY, Friday-only for old SENSEX) → use it
    //   - else SENSEX auto: Tue post-cutover, Fri before
    const targetDow = lockedDow != null ? lockedDow : resolveInstrumentDow(instrument, cursor, cutover);

    if (dow === targetDow) {
      const ymd = toYmd(cursor);
      const eraName = eraForDow({ instrument, lockedDow, targetDow, isAfterCutover });

      if (!INDIA_HOLIDAYS_APPROX.has(ymd)) {
        expiries.push({ date: ymd, weekday: DOW_NAMES[targetDow], era: eraName });
      } else {
        // Holiday on expiry day — shift one day earlier (NSE/BSE rule)
        const prev = new Date(cursor.getTime() - 86400000);
        const prevYmd = toYmd(prev);
        if (!INDIA_HOLIDAYS_APPROX.has(prevYmd) && prev.getUTCDay() !== 0 && prev.getUTCDay() !== 6) {
          expiries.push({
            date: prevYmd,
            weekday: DOW_NAMES[prev.getUTCDay()],
            era: eraName,
            shiftedFrom: ymd
          });
        }
      }
      // Jump back 7 days
      cursor.setUTCDate(cursor.getUTCDate() - 7);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    if (cursor.getUTCFullYear() < 2019) break;
  }

  return expiries.reverse();
}

module.exports = {
  generateExpiryDays,
  toYmd,
  DOW_TUE,
  DOW_WED,
  DOW_THU,
  DOW_FRI
};
