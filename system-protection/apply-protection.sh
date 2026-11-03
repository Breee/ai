#!/usr/bin/env bash
# System Protection Stack — applies all layers
# Run as root: sudo bash apply-protection.sh
set -euo pipefail

echo "=== Layer 1: systemd-oomd (userspace OOM killer) ==="
cp oomd.conf /etc/systemd/oomd.conf.d/protect.conf 2>/dev/null || {
  mkdir -p /etc/systemd/oomd.conf.d
  cp oomd.conf /etc/systemd/oomd.conf.d/protect.conf
}
systemctl daemon-reload
systemctl enable --now systemd-oomd
systemctl status systemd-oomd --no-pager -l | head -5
echo ""

echo "=== Layer 2: sysctl hardening ==="
cp 99-protection.conf /etc/sysctl.d/99-protection.conf
sysctl -p /etc/sysctl.d/99-protection.conf
echo ""

echo "=== Layer 3: Docker daemon defaults ==="
# Merge with existing config
if [ -f /etc/docker/daemon.json ]; then
  echo "Existing daemon.json found. Backing up to /etc/docker/daemon.json.bak"
  cp /etc/docker/daemon.json /etc/docker/daemon.json.bak
fi
cp daemon.json /etc/docker/daemon.json
echo "Restarting Docker (containers will briefly pause)..."
systemctl restart docker
echo "Docker restarted."
echo ""

echo "=== Layer 4: cgroup memory limits for Docker ==="
# Set hard memory limit on the entire Docker cgroup
# This prevents Docker from using more than 16GB total
mkdir -p /etc/systemd/system/docker.service.d/
cat > /etc/systemd/system/docker.service.d/memory-limit.conf << 'EOF'
[Service]
MemoryMax=16G
MemoryHigh=14G
EOF
systemctl daemon-reload
systemctl restart docker
echo "Docker memory cap: 16GB max, warning at 14GB"
echo ""

echo "=== All layers applied ==="
echo "Verify with: systemd-oomd status / systemctl status systemd-oomd"
echo "             sysctl vm.overcommit_memory vm.oom_kill_allocating_task"
echo "             docker info | grep -i ulimit"
