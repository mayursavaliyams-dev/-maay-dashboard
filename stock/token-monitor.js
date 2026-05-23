/**
 * DHAN TOKEN MONITOR
 * Decodes the DHAN_ACCESS_TOKEN JWT and reports expiry. Dhan tokens expire daily,
 * so live auto-trading must refuse entries on an expired token (the engine already
 * does this) — this module surfaces the status to the dashboard and alerts the
 * operator before market open so the token can be refreshed in time.
 */

function decodeExp(token) {
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString());
    return payload.exp ? Number(payload.exp) : null;   // seconds since epoch
  } catch (_) { return null; }
}

function tokenStatus() {
  const token = process.env.DHAN_ACCESS_TOKEN || '';
  if (!token) return { valid: false, reason: 'no DHAN_ACCESS_TOKEN set' };
  const exp = decodeExp(token);
  if (!exp) return { valid: false, reason: 'token present but not a decodable JWT' };
  const now = Math.floor(Date.now() / 1000);
  const secsLeft = exp - now;
  return {
    valid: secsLeft > 0,
    expiresAt: new Date(exp * 1000).toISOString(),
    expiresAtIST: new Date((exp * 1000) + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' IST',
    hoursLeft: +(secsLeft / 3600).toFixed(2),
    secsLeft
  };
}

/**
 * Start a once-a-minute checker that fires the alert callback once per day at
 * ~08:30 IST if the token is expired or has < warnHours left. Paper mode skips.
 * Returns the interval handle so the server can clear it on shutdown.
 */
function startMonitor({ onWarn, warnHours = 2, paperMode = false } = {}) {
  let warnedDate = '';
  return setInterval(() => {
    if (paperMode) return;
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const hh = ist.getUTCHours(), mm = ist.getUTCMinutes();
    const day = ist.toISOString().slice(0, 10);
    if (hh !== 8 || mm !== 30 || warnedDate === day) return;
    warnedDate = day;
    const st = tokenStatus();
    if (st.valid && st.hoursLeft > warnHours) return;   // healthy — no alert
    const msg = st.valid
      ? `Dhan token expires in ${st.hoursLeft}h (${st.expiresAtIST}). Refresh before market open.`
      : `Dhan token INVALID/EXPIRED (${st.reason || st.expiresAtIST}). Live trading will refuse entries.`;
    console.warn(`[token] ⚠️ ${msg}`);
    if (onWarn) { try { onWarn(st.valid ? 'Dhan token expiring' : 'Dhan token invalid', msg); } catch (_) {} }
  }, 60 * 1000);
}

module.exports = { tokenStatus, decodeExp, startMonitor };
