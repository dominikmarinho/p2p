#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Execute como root' >&2; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
install -d -m 755 /opt/highpass/monitoring/textfile
install -m 755 scripts/collect-container-metrics.py /usr/local/sbin/highpass-container-metrics
cat > /etc/systemd/system/highpass-container-metrics.service <<'UNIT'
[Unit]
Description=Highpass container and host textfile metrics
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/highpass-container-metrics
TimeoutStartSec=14
MemoryMax=64M
CPUQuota=25%
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/highpass/monitoring/textfile
ProtectHome=true
PrivateTmp=true
UNIT
cat > /etc/systemd/system/highpass-container-metrics.timer <<'UNIT'
[Unit]
Description=Collect Highpass metrics every 15 seconds
[Timer]
OnBootSec=15
OnUnitActiveSec=15
AccuracySec=1
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now highpass-container-metrics.timer
systemctl start highpass-container-metrics.service
