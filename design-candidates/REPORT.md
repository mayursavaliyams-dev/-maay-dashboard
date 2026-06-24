# 10 Website Designs — Build, Test & Apply Report

**Task:** One HTML website for the Antigravity Pro trading bot. Built 10 designs, tested each, applied the best.
**Date:** 2026-06-16

## ✅ APPLIED WINNER → `public/site.html`
**#04 minimal-swiss** — score 92/100, verified flawless on desktop + mobile, zero overflow.
Live at: **http://localhost:3000/site.html**

## Scoreboard (AI critique + my visual verification)

| Rank | # | Style | Score | Overflow | Verified |
|---|---|---|---|---|---|
| 🥇 1 | 04 | **minimal-swiss** | 92 | ok | ✅ clean desktop + mobile, premium |
| 🥈 2 | 08 | chart-hero | 91 | ok | ✅ real candlestick hero, data-forward |
| 🥉 3 | 07 | pro-corporate | 89 | ok | ✅ trustworthy fintech layout |
| 4 | 09 | dark-luxe-gold | 89 | RISK | gold/serif luxe |
| 5 | 01 | glass-terminal | 88 | RISK | ⚠ confirmed clipped on mobile |
| 6 | 05 | gradient-aurora | 88 | ok | vibrant mesh gradients |
| 7 | 03 | neon-cyber | 86 | RISK | cyberpunk neon |
| 8 | 06 | card-grid-bento | 84 | ok | bento tile grid |
| 9 | 10 | motion-animated | 78 | RISK | animation-heavy |
| 10 | 02 | bloomberg-dense | 71 | ok | terminal density (too dense) |

## Why minimal-swiss won
- **Highest score AND verified in real screenshots** (not just trusting the AI critique — I screenshotted all 10 at 1440px desktop + 390px mobile via headless Chrome and looked).
- Strong Swiss typographic hierarchy: "Signals that **respect** the cost of being wrong." with green accent.
- **Perfect mobile** — indices collapse to a clean vertical list, CTAs fit, no horizontal scroll. (By contrast, glass-terminal #01 — same AI tier — was visibly **clipped** on mobile; testing caught what the score didn't fully penalize.)
- On-brand: navy gradient, #38d39f green, IBM Plex, glass nav.

## Live data wiring (all 10, winner verified)
Fetches `/api/nifty`, `/api/sensex`, `/api/banknifty`, `/api/bot/status` — all confirmed to exist in server.js.
Uses `.catch()` + `AbortController` timeout + demo fallback → page looks complete even if APIs are down.
Final deployed shot showed REAL data: NIFTY 23,922 / SENSEX 76,569 / BANKNIFTY 57,120, and "Trades 0/100" (your live MAX_TRADES_PER_DAY=100).

## Artifacts kept
- `public/site.html` — the live winner (this is what's deployed)
- `design-candidates/design-01..10-*.html` — all 10 source files (swap anytime by copying over site.html)
- `design-shots/shot-NN-desktop.png` + `shot-NN-mobile.png` — proof screenshots for all 10
- `design-shots/FINAL-site.png` — the deployed winner

## To switch designs later
```
cp design-candidates/design-08-chart-hero.html public/site.html   # e.g. use chart-hero instead
```
