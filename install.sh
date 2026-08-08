#!/usr/bin/env bash
# =============================================================================
# Verafi one-command installer
#
# Run this on a fresh Ubuntu server:
#     curl -fsSL https://raw.githubusercontent.com/ngarg88/verafi/main/install.sh | sudo bash
#
# It asks for three things, then does everything else itself.
# =============================================================================
set -euo pipefail
[ "$EUID" -eq 0 ] || { echo "Run with sudo:  curl -fsSL <url> | sudo bash"; exit 1; }

TARBALL="https://github.com/ngarg88/verafi/archive/refs/heads/main.tar.gz"

echo
echo "  ============================================"
echo "   VERAFI INSTALLER"
echo "  ============================================"
echo
read -rp  "  1/3  Tailscale auth key (tskey-auth-...) : " TS_AUTHKEY
read -rp  "  2/3  App passcode (long, memorable)      : " APP_PASSCODE
read -rp  "  3/3  ntfy topic (from your phone)        : " NTFY_TOPIC
echo
[ -n "$TS_AUTHKEY" ] && [ -n "$APP_PASSCODE" ] && [ -n "$NTFY_TOPIC" ] || { echo "  All three are required."; exit 1; }

echo "  [1/6] system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates >/dev/null

echo "  [2/6] node 22"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs >/dev/null
node -v

echo "  [3/6] tailscale  (private network - nothing is exposed publicly)"
curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1
tailscale up --authkey="$TS_AUTHKEY" --hostname=verafi --ssh
TS_IP=$(tailscale ip -4 | head -1)
echo "        tailnet ip: $TS_IP"

echo "  [4/6] app"
rm -rf /opt/verafi /tmp/app.tgz /tmp/unpack
curl -fsSL "$TARBALL" -o /tmp/app.tgz
mkdir -p /tmp/unpack && tar xzf /tmp/app.tgz -C /tmp/unpack
mv /tmp/unpack/verafi-* /opt/verafi
test -f /opt/verafi/verafi/server.js || { echo "  FATAL: app not found in the tarball"; ls -R /tmp/unpack | head -30; exit 1; }
mkdir -p /var/lib/verafi /opt/verafi/verafi/statements
id verafi >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin verafi
chown -R verafi:verafi /var/lib/verafi /opt/verafi

cat >/etc/verafi.env <<ENV
PORT=8788
HOST=0.0.0.0
DATA_DIR=/var/lib/verafi
AGENT_INTERVAL_HOURS=24
AUTO_ENABLE_AGENTS=1
APP_PASSCODE=$APP_PASSCODE
SESSION_SECRET=$(openssl rand -hex 32)
NTFY_TOPIC=$NTFY_TOPIC
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
ENV
chmod 600 /etc/verafi.env

echo "  [5/6] service"
cat >/etc/systemd/system/verafi.service <<'UNIT'
[Unit]
Description=Verafi
After=network-online.target tailscaled.service
[Service]
User=verafi
WorkingDirectory=/opt/verafi
EnvironmentFile=/etc/verafi.env
ExecStart=/usr/bin/node verafi/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/verafi /opt/verafi/verafi/statements
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now verafi

echo "  [6/6] firewall - allow ONLY the tailscale interface"
iptables -I INPUT 1 -i tailscale0 -p tcp --dport 8788 -j ACCEPT 2>/dev/null || true
(command -v netfilter-persistent >/dev/null && netfilter-persistent save) >/dev/null 2>&1 || true

sleep 6
if systemctl is-active --quiet verafi; then
  curl -s -H "Title: Verafi is live" \
       -d "Open http://verafi:8788 on your phone with Tailscale connected. Unlock with your passcode." \
       "https://ntfy.sh/$NTFY_TOPIC" >/dev/null || true
  echo
  echo "  ============================================"
  echo "   DONE."
  echo "   On your phone (Tailscale connected):"
  echo "       http://verafi:8788"
  echo "   or  http://$TS_IP:8788"
  echo "  ============================================"
  echo
else
  echo "  Service did not start. Logs:"
  journalctl -u verafi -n 30 --no-pager
  exit 1
fi
