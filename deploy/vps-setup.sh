#!/usr/bin/env bash
# One-shot VPS bootstrap for Expiry-Friday-5x.
# Run on a fresh Ubuntu 22.04 / 24.04 VPS as a user with sudo.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/vps-setup.sh -o setup.sh
#   chmod +x setup.sh
#   sudo DOMAIN=sareetex.in EMAIL=you@example.com REPO=https://github.com/you/repo.git ./setup.sh
#
# Required env vars:
#   DOMAIN  — your domain (already A-record'd to this VPS IP)
#   EMAIL   — for Let's Encrypt cert
#   REPO    — your git repo URL (HTTPS or SSH)

set -euo pipefail

: "${DOMAIN:?DOMAIN env var required}"
: "${EMAIL:?EMAIL env var required}"
: "${REPO:?REPO env var required}"

APP_USER="${APP_USER:-expiry}"
APP_DIR="/home/${APP_USER}/app"
APP_NAME="expiry-bot"
NODE_VERSION="20"

echo "==> Updating apt"
apt update -y

echo "==> Installing Node ${NODE_VERSION}, nginx, certbot, git, ufw"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs nginx certbot python3-certbot-nginx git ufw

echo "==> Installing pm2 globally"
npm i -g pm2

echo "==> Creating app user ${APP_USER} (if missing)"
id -u "${APP_USER}" &>/dev/null || adduser --disabled-password --gecos "" "${APP_USER}"

echo "==> Cloning repo to ${APP_DIR}"
if [ ! -d "${APP_DIR}/.git" ]; then
  sudo -u "${APP_USER}" git clone "${REPO}" "${APP_DIR}"
else
  sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only
fi

echo "==> npm install (production)"
sudo -u "${APP_USER}" bash -lc "cd ${APP_DIR} && npm install --omit=dev"

if [ ! -f "${APP_DIR}/.env" ]; then
  echo "==> .env missing — creating template, FILL IT IN BEFORE STARTING"
  sudo -u "${APP_USER}" bash -lc "cat > ${APP_DIR}/.env <<'EOF'
PORT=3000
NODE_ENV=production
DHAN_CLIENT_ID=
DHAN_API_KEY=
DHAN_API_SECRET=
DHAN_ACCESS_TOKEN=
PUBLIC_API_BASE_URL=
CORS_ORIGINS=https://${DOMAIN}
TRADE_MODE=paper
EOF
  chmod 600 ${APP_DIR}/.env"
  echo ""
  echo "  Edit:  sudo -u ${APP_USER} nano ${APP_DIR}/.env"
  echo "  Then:  sudo systemctl restart pm2-${APP_USER}"
  echo ""
fi

echo "==> Configuring nginx for ${DOMAIN}"
cat > /etc/nginx/sites-available/${APP_NAME} <<EOF
server {
  listen 80;
  server_name ${DOMAIN} www.${DOMAIN};

  client_max_body_size 10M;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 86400;
  }
}
EOF
ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/${APP_NAME}
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Firewall: allow SSH + HTTP + HTTPS"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
yes | ufw enable || true

echo "==> Starting pm2 process"
sudo -u "${APP_USER}" bash -lc "cd ${APP_DIR} && pm2 start server.js --name ${APP_NAME} || pm2 restart ${APP_NAME}"
sudo -u "${APP_USER}" bash -lc "pm2 save"
env PATH=$PATH:/usr/bin pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" | tail -1 | bash

echo "==> Requesting Let's Encrypt cert for ${DOMAIN}"
certbot --nginx --non-interactive --agree-tos --redirect \
  -d "${DOMAIN}" -d "www.${DOMAIN}" -m "${EMAIL}" || \
  echo "  (cert request failed — re-run: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN})"

echo ""
echo "============================================================"
echo "  DONE.  https://${DOMAIN}  should now serve the dashboard."
echo ""
echo "  Logs:        sudo -u ${APP_USER} pm2 logs ${APP_NAME}"
echo "  Restart:     sudo -u ${APP_USER} pm2 restart ${APP_NAME}"
echo "  Update code: sudo -u ${APP_USER} bash -lc 'cd ${APP_DIR} && git pull && npm install --omit=dev && pm2 restart ${APP_NAME}'"
echo "  Edit .env:   sudo -u ${APP_USER} nano ${APP_DIR}/.env"
echo "============================================================"
