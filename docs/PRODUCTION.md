# Production Hardening — Auth · Docker · CI/CD

Module 1 of the enterprise track. Everything here is **opt-in**: with `AUTH_ENABLED`
unset, the dashboard behaves exactly as before (no login) — ideal for local use.

---

## 1. Authentication (JWT + RBAC)

Self-contained (`auth.js`, no external deps): HS256 JWT in an **HttpOnly cookie**
(`ag_token`) + scrypt password hashing. Because the token rides in a cookie the
browser auto-sends, **no existing endpoint or fetch had to change**.

Roles: `viewer` < `trader` < `admin`.
- **viewer** — read all data (GET).
- **trader** — also mutations (POST/PUT/DELETE and `enable·run·reset·order·…` routes).
- **admin** — everything (config etc.).

### Enable it

```ini
# .env (never committed)
AUTH_ENABLED=true
AUTH_SECRET=<paste 64+ random chars>          # openssl rand -hex 48
AUTH_ADMIN_USER=admin
AUTH_ADMIN_PASS=<your password>               # auto-hashed at boot
AUTH_TOKEN_TTL_HOURS=12
AUTH_COOKIE_SECURE=true                        # only when served over HTTPS
```

Extra users with pre-hashed passwords (so plaintext never sits in env):

```bash
# generate a scrypt hash
node -e "console.log(require('./auth').hashPassword('TraderPass1'))"
# → scrypt$<salt>$<hash>   — put it in AUTH_USERS:
```
```ini
AUTH_USERS=[{"u":"trader1","p":"scrypt$....$....","role":"trader"},{"u":"view1","p":"scrypt$..","role":"viewer"}]
```

### Flow
1. Unauthenticated browser hits any page → redirected to **`/login.html`**.
2. Login → server sets the `ag_token` cookie → redirect back.
3. All `/api/*` calls carry the cookie automatically; reads need viewer, writes need trader.
4. Endpoints `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/health`, `/healthz` are open.

Disable any time: remove `AUTH_ENABLED` (or set `false`) and restart → no login.

---

## 2. Health checks

- `GET /healthz` — fast public liveness (`{status, uptimeSec, authEnabled, ts}`) for Docker/K8s/Nginx.
- `GET /api/health` — existing detailed data-source health.

---

## 3. Docker

```bash
docker build -t antigravity-pro .
docker run -d --name ag -p 3000:3000 --env-file .env antigravity-pro
# health: docker inspect --format '{{.State.Health.Status}}' ag
```

### Compose (app + redis)
```bash
docker compose up -d --build
docker compose logs -f app
```
`docker-compose.yml` wires Redis (`REDIS_URL=redis://redis:6379`), restart policy,
health checks, and forces `TRADE_MODE=paper`. Secrets load from `.env` at runtime
(`.dockerignore` keeps `.env`, logs, and the heavy 1-min JSONs out of the image).

---

## 4. CI/CD (GitHub Actions)

`.github/workflows/ci.yml` runs on push/PR:
- **node** — `node -c` syntax check of core modules, inline-script validation of every
  dashboard page, an `auth.js` unit test (sign/verify/tamper/login/role) and a
  `candlestick-patterns` detector test.
- **python** — installs + runs the `antigravity-py` FastAPI port's pytest (non-blocking).

---

## 5. Nginx + HTTPS

`nginx/antigravity.conf` — HTTP→HTTPS redirect, TLS, HSTS + security headers, gzip,
WebSocket upgrade (Dhan feed), and a no-log `/healthz` location. Replace the domain
and cert paths, then `certbot --nginx -d your-domain.com`. Set `AUTH_COOKIE_SECURE=true`
once you're on HTTPS.

---

## Notes
- **Never** commit `.env` (holds `UPSTOX_ACCESS_TOKEN`, `AUTH_SECRET`, passwords).
- `TRADE_MODE=paper` everywhere — live execution stays a separate, explicit module.
