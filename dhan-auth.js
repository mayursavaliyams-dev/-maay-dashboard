function normalizeDhanClientId(value) {
  return String(value || '').trim();
}

function normalizeDhanAccessToken(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function decodeJwtPart(part) {
  const clean = String(part || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function isLikelyJwt(token) {
  const parts = normalizeDhanAccessToken(token).split('.');
  return parts.length === 3 && parts.every(Boolean);
}

function decodeDhanAccessToken(token) {
  const clean = normalizeDhanAccessToken(token);
  if (!isLikelyJwt(clean)) return null;
  try {
    return JSON.parse(decodeJwtPart(clean.split('.')[1]));
  } catch (_) {
    return null;
  }
}

function getDhanTokenStatus(token) {
  const payload = decodeDhanAccessToken(token);
  const exp = Number(payload?.exp || 0);
  if (!exp) {
    return { valid: false, reason: 'no token or malformed JWT', expiresAt: null, hoursLeft: null };
  }
  const now = Math.floor(Date.now() / 1000);
  const secsLeft = exp - now;
  return {
    valid: secsLeft > 0,
    expiresAt: new Date(exp * 1000).toISOString(),
    expiresAtIST: new Date((exp + 5.5 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' IST',
    hoursLeft: +(secsLeft / 3600).toFixed(2),
    reason: secsLeft > 0 ? null : 'expired',
    payload,
  };
}

function validateDhanCredentials(clientId, token) {
  const normalizedClientId = normalizeDhanClientId(clientId);
  const tokenStatus = getDhanTokenStatus(token);
  const tokenClientId = normalizeDhanClientId(tokenStatus.payload?.dhanClientId);

  if (!normalizedClientId) {
    return { ok: false, reason: 'missing client id', tokenStatus, tokenClientId };
  }
  if (!tokenStatus.valid) {
    return { ok: false, reason: tokenStatus.reason || 'invalid token', tokenStatus, tokenClientId };
  }
  if (tokenClientId && tokenClientId !== normalizedClientId) {
    return {
      ok: false,
      reason: `token client id ${tokenClientId} does not match DHAN_CLIENT_ID ${normalizedClientId}`,
      tokenStatus,
      tokenClientId
    };
  }
  return { ok: true, reason: null, tokenStatus, tokenClientId };
}

module.exports = {
  normalizeDhanClientId,
  normalizeDhanAccessToken,
  isLikelyJwt,
  decodeDhanAccessToken,
  getDhanTokenStatus,
  validateDhanCredentials,
};
