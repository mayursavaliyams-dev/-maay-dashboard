# Cloud Deployment Guide: FastAPI Options Trading Bot

This project's FastAPI entry point is `options_algo_api:app`. The commands below deploy it on Ubuntu with systemd, Nginx, and HTTPS.

## Recommended Platform

Use Amazon Lightsail Ubuntu 24.04 for the first production move. It is simpler than raw EC2, gives a predictable monthly bundle, includes static IP and DNS features, and still behaves like a normal Linux server. A 1 GB or 2 GB instance is a better minimum than 512 MB once pandas and SmartAPI are loaded.

Good alternatives:

- AWS EC2 Ubuntu `t3.micro`/`t4g.micro`: more flexible, but billing and IPv4 details are less beginner-friendly.
- Render paid web service: easiest Git deploy and a permanent HTTPS URL, but use paid only. Free web services can sleep and lose local files.
- Heroku: usable with the included `Procfile`, but usually not the cheapest for a 24/7 trading bot.

## Permanent Webhook URL

For Lightsail:

1. Create an Ubuntu instance.
2. Create and attach a Lightsail static IP.
3. Add a DNS `A` record: `bot.yourdomain.com -> STATIC_IP`.
4. TradingView webhook URL becomes:

```text
https://bot.yourdomain.com/api/webhook-signal
```

For EC2, allocate and associate an Elastic IP, then point your DNS `A` record to it.

## Server Bootstrap

SSH into the server:

```bash
ssh ubuntu@YOUR_SERVER_IP
```

Install OS packages:

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip nginx git ufw certbot python3-certbot-nginx
```

Create a locked-down app user and folders:

```bash
sudo adduser --system --group --home /opt/antigravity-bot antigravity
sudo mkdir -p /opt/antigravity-bot /etc/antigravity-bot /var/log/antigravity-bot
sudo chown -R antigravity:antigravity /opt/antigravity-bot /var/log/antigravity-bot
sudo chmod 750 /etc/antigravity-bot
```

Deploy code with Git:

```bash
sudo -u antigravity git clone YOUR_GIT_REPO_URL /opt/antigravity-bot
cd /opt/antigravity-bot
sudo -u antigravity python3 -m venv venv
sudo -u antigravity ./venv/bin/pip install --upgrade pip wheel
sudo -u antigravity ./venv/bin/pip install -r requirements.txt
```

If you are not using Git yet, copy the project from Windows:

```powershell
scp -r C:\Users\Admin\Downloads\Expiry-Friday-5x ubuntu@YOUR_SERVER_IP:/tmp/antigravity-bot
```

Then on Ubuntu:

```bash
sudo rsync -a /tmp/antigravity-bot/ /opt/antigravity-bot/
sudo chown -R antigravity:antigravity /opt/antigravity-bot
```

## Environment Variables

Never commit `.env`. Keep production secrets in `/etc/antigravity-bot/antigravity.env`.

```bash
sudo cp /opt/antigravity-bot/deploy/antigravity.env.example /etc/antigravity-bot/antigravity.env
sudo nano /etc/antigravity-bot/antigravity.env
sudo chown root:antigravity /etc/antigravity-bot/antigravity.env
sudo chmod 640 /etc/antigravity-bot/antigravity.env
```

Start with `LIVE_TRADING=false`. Flip it only after health checks, paper orders, and webhook tests pass.

## systemd Service

Install and start the service:

```bash
sudo cp /opt/antigravity-bot/deploy/antigravity-fastapi.service /etc/systemd/system/antigravity-fastapi.service
sudo systemctl daemon-reload
sudo systemctl enable --now antigravity-fastapi
sudo systemctl status antigravity-fastapi --no-pager
curl http://127.0.0.1:8091/health
```

Operational commands:

```bash
sudo systemctl restart antigravity-fastapi
sudo systemctl stop antigravity-fastapi
sudo journalctl -u antigravity-fastapi -f
```

## Nginx and HTTPS

Replace `bot.example.com` with your real domain:

```bash
sudo sed 's/bot.example.com/bot.yourdomain.com/g' /opt/antigravity-bot/deploy/nginx-antigravity.conf | sudo tee /etc/nginx/sites-available/antigravity
sudo ln -sf /etc/nginx/sites-available/antigravity /etc/nginx/sites-enabled/antigravity
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Open the firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

Issue the TLS certificate:

```bash
sudo certbot --nginx -d bot.yourdomain.com
curl https://bot.yourdomain.com/health
```

## TradingView Test

Set TradingView webhook URL:

```text
https://bot.yourdomain.com/api/webhook-signal
```

Example payload:

```json
{"trend":"BULLISH","index":"NIFTY","source":"tradingview","secret":"same-value-as-TRADINGVIEW_WEBHOOK_SECRET","metadata":{"strategy":"test"}}
```

Verify:

```bash
curl -X POST https://bot.yourdomain.com/api/webhook-signal \
  -H 'Content-Type: application/json' \
  -d '{"trend":"BULLISH","index":"NIFTY","source":"manual-test","secret":"same-value-as-TRADINGVIEW_WEBHOOK_SECRET"}'
```

If `TRADINGVIEW_WEBHOOK_SECRET` is blank, the API accepts webhook payloads without the `secret` field. For production, set it.

## TallyPrime Challenge

Do not expose `http://localhost:9000` directly to the public internet.

Best production pattern: cloud queues the XML, and a small office-PC agent pulls pending XML and posts it to local Tally at `http://localhost:9000`. This keeps Tally private and tolerates office internet outages. This repo now includes these cloud endpoints:

```text
GET  /api/tally/pending
POST /api/tally/ack
```

Live executions queue XML automatically and the trade response includes `tally_queue_id`. Use `deploy/tally-local-agent.py` on the office PC.

Office PC setup:

```powershell
cd C:\Users\Admin\Downloads\Expiry-Friday-5x
python -m pip install requests
$env:CLOUD_TALLY_PULL_URL="https://bot.yourdomain.com/api/tally/pending"
$env:CLOUD_TALLY_ACK_URL="https://bot.yourdomain.com/api/tally/ack"
$env:TALLY_AGENT_TOKEN="same-token-as-cloud"
$env:TALLY_URL="http://localhost:9000"
python deploy\tally-local-agent.py
```

On Windows, run that script at startup with Task Scheduler after testing it manually. The cloud endpoint requires:

```text
Authorization: Bearer <TALLY_AGENT_TOKEN>
```

Alternative: install Tailscale on the cloud server and office PC. Then set `TALLY_URL=http://100.x.y.z:9000` using the office PC's Tailscale IP. This is convenient, but Tally posting still depends on the office PC being powered on.

Cloud Tailscale install:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
tailscale status
```

## Logging and Monitoring

systemd logs:

```bash
sudo journalctl -u antigravity-fastapi -n 100 --no-pager
sudo journalctl -u antigravity-fastapi -f
```

File logs:

```bash
sudo tail -f /var/log/antigravity-bot/app.log
sudo tail -f /var/log/antigravity-bot/error.log
sudo tail -f /var/log/nginx/antigravity.access.log
```

Webhook and API error logging is already wired through `deploy/fastapi_logging_snippet.py`. After changing log settings, restart:

```bash
sudo systemctl restart antigravity-fastapi
```

## Updating Code

```bash
cd /opt/antigravity-bot
sudo -u antigravity git pull --ff-only
sudo -u antigravity ./venv/bin/pip install -r requirements.txt
sudo systemctl restart antigravity-fastapi
sudo journalctl -u antigravity-fastapi -n 50 --no-pager
```
