#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu box (Oracle Always Free, GCP e2-micro, any VPS).
# Installs Node, Chromium's system libraries, adds swap, and registers a systemd
# service so the sniper starts on boot and restarts on crash.
#
# Usage, from inside the uploaded project folder:
#   sudo bash deploy/setup-vps.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"

echo "==> Installing into $APP_DIR as user $RUN_USER"

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo: sudo bash deploy/setup-vps.sh" >&2
  exit 1
fi

# --- swap ------------------------------------------------------------------
# Chromium briefly needs ~600MB during token harvest. On a 1GB box that is the
# difference between working and being OOM-killed, so guarantee some headroom.
if ! swapon --show | grep -q .; then
  echo "==> Creating 2GB swap file"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "==> Swap already present, skipping"
fi

# --- node ------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "==> Node $(node -v) already installed"
fi

# --- app deps + chromium ---------------------------------------------------
echo "==> Installing npm dependencies"
cd "$APP_DIR"
sudo -u "$RUN_USER" npm ci --omit=dev

echo "==> Installing Chromium and its system libraries"
sudo -u "$RUN_USER" npx playwright install --with-deps chromium

mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR/data"

# --- systemd service -------------------------------------------------------
echo "==> Registering systemd service"
cat > /etc/systemd/system/amazon-job-sniper.service <<EOF
[Unit]
Description=Amazon Job Sniper
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v node) $APP_DIR/src/index.js
Restart=always
RestartSec=15
StandardOutput=append:$APP_DIR/data/sniper.log
StandardError=append:$APP_DIR/data/sniper.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable amazon-job-sniper

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo ""
  echo "!! No .env found. Create it before starting:"
  echo "     cp $APP_DIR/.env.example $APP_DIR/.env && nano $APP_DIR/.env"
  echo "   Then: sudo systemctl start amazon-job-sniper"
else
  systemctl restart amazon-job-sniper
  echo ""
  echo "==> Started."
fi

echo ""
echo "Commands:"
echo "  sudo systemctl status amazon-job-sniper"
echo "  tail -f $APP_DIR/data/sniper.log"
echo "  sudo systemctl restart amazon-job-sniper"
echo "  sudo systemctl stop amazon-job-sniper"
