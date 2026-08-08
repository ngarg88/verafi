#!/usr/bin/env bash
# Verafi on an Oracle Cloud Always Free VM. Genuinely free, always on.
# Copy this repo to the VM, then:  bash deploy-oracle.sh
set -euo pipefail

echo "==> Node 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

APP_DIR="$HOME/verafi-app"
mkdir -p "$APP_DIR" && cp -r packages verafi "$APP_DIR/"
mkdir -p "$HOME/verafi-data"

echo "==> secrets"
read -rsp "Passcode to unlock the app: " PASSCODE; echo
SESSION_SECRET=$(openssl rand -hex 32)
read -rp  "Plaid CLIENT_ID (blank to skip): " PLAID_ID
if [ -n "$PLAID_ID" ]; then
  read -rsp "Plaid SECRET: " PLAID_SECRET; echo
  read -rp  "Plaid env [sandbox/production]: " PLAID_ENV
fi
NTFY_TOPIC="verafi-$(openssl rand -hex 5)"

sudo tee /etc/verafi.env >/dev/null <<ENV
PORT=8788
HOST=0.0.0.0
DATA_DIR=$HOME/verafi-data
APP_PASSCODE=$PASSCODE
SESSION_SECRET=$SESSION_SECRET
NTFY_TOPIC=$NTFY_TOPIC
AGENT_INTERVAL_HOURS=24
PLAID_CLIENT_ID=${PLAID_ID:-}
PLAID_SECRET=${PLAID_SECRET:-}
PLAID_ENV=${PLAID_ENV:-sandbox}
ENV
sudo chmod 600 /etc/verafi.env

echo "==> systemd service"
sudo tee /etc/systemd/system/verafi.service >/dev/null <<UNIT
[Unit]
Description=Verafi
After=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/verafi.env
ExecStart=$(command -v node) verafi/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now verafi

echo "==> firewall (Oracle images block everything by default)"
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8788 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || true

echo "==> HTTPS via Cloudflare Tunnel (free, no open ports needed)"
if ! command -v cloudflared >/dev/null; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cf.deb
  sudo dpkg -i /tmp/cf.deb
fi
echo
echo "  Now run:  cloudflared tunnel login"
echo "            cloudflared tunnel create verafi"
echo "            cloudflared tunnel route dns verafi verafi.yourdomain.com"
echo "            sudo cloudflared service install"
echo
sudo systemctl --no-pager status verafi | head -5
echo
echo "  Verafi is live on this VM."
echo "  ntfy topic for phone alerts:  $NTFY_TOPIC"
