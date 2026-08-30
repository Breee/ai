#!/bin/bash
set -euo pipefail

# install-kata.sh — Install Kata Containers and register with Docker
#
# Usage: sudo ./install-kata.sh [version]
#   version: Kata release version (default: latest)

KATA_VERSION="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KATA_DIR="/opt/kata"

echo "[kata] Kata Containers installer"

# ── Preflight checks ──────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    echo "[kata] ERROR: must run as root"
    exit 1
fi

if ! grep -qE '(vmx|svm)' /proc/cpuinfo; then
    echo "[kata] ERROR: no hardware virtualization (vmx/svm)"
    exit 1
fi

if [ ! -e /dev/kvm ]; then
    echo "[kata] ERROR: /dev/kvm not found"
    exit 1
fi

if ! command -v docker &>/dev/null; then
    echo "[kata] ERROR: docker not installed"
    exit 1
fi

DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null)
if [ "$(echo "$DOCKER_VER" | cut -d. -f1)" -lt 26 ]; then
    echo "[kata] ERROR: Docker $DOCKER_VER too old, need 26+"
    exit 1
fi

if ! command -v zstd &>/dev/null; then
    echo "[kata] Installing zstd..."
    apt-get update && apt-get install -y zstd
fi

# ── Resolve version ────────────────────────────────────────────────────
if [ -z "$KATA_VERSION" ]; then
    echo "[kata] Resolving latest release..."
    KATA_VERSION=$(curl -sL "https://api.github.com/repos/kata-containers/kata-containers/releases/latest" | jq -r ".tag_name")
    echo "[kata] Latest: $KATA_VERSION"
fi

# ── Download ───────────────────────────────────────────────────────────
TARBALL="kata-static-${KATA_VERSION}-amd64.tar.zst"
URL="https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/${TARBALL}"

echo "[kata] Downloading $URL ..."
cd /tmp
curl -fLO "$URL"

# ── Extract ────────────────────────────────────────────────────────────
echo "[kata] Extracting to / ..."
tar --zstd -xf "$TARBALL" -C /

# ── Symlink binaries ──────────────────────────────────────────────────
echo "[kata] Linking binaries..."
ln -sf "${KATA_DIR}/bin/kata-runtime" /usr/local/bin/kata-runtime
ln -sf "${KATA_DIR}/bin/containerd-shim-kata-v2" /usr/local/bin/containerd-shim-kata-v2

# Also link kata-collect-data for debugging
ln -sf "${KATA_DIR}/bin/kata-collect-data.sh" /usr/local/bin/kata-collect-data.sh 2>/dev/null || true

# ── Verify ─────────────────────────────────────────────────────────────
echo "[kata] Verifying..."
kata-runtime --version
kata-runtime check || echo "[kata] WARNING: check reported issues (non-fatal)"

# ── Register with Docker ───────────────────────────────────────────────
DAEMON_JSON="/etc/docker/daemon.json"
BACKUP="${DAEMON_JSON}.bak.$(date +%s)"

if [ -f "$DAEMON_JSON" ]; then
    cp "$DAEMON_JSON" "$BACKUP"
    echo "[kata] Backed up $DAEMON_JSON → $BACKUP"

    # Merge: preserve existing runtimes, add kata if missing
    if jq -e '.runtimes.kata' "$DAEMON_JSON" &>/dev/null; then
        echo "[kata] 'kata' runtime already in $DAEMON_JSON"
    else
        echo "[kata] Adding kata runtime to $DAEMON_JSON..."
        jq '. + {"runtimes": (.runtimes // {} | . + {"kata": {"runtimeType": "io.containerd.kata.v2"}})}' \
            "$DAEMON_JSON" > "${DAEMON_JSON}.tmp"
        mv "${DAEMON_JSON}.tmp" "$DAEMON_JSON"
    fi
else
    echo "[kata] Creating $DAEMON_JSON..."
    cat > "$DAEMON_JSON" <<'EOF'
{
  "runtimes": {
    "kata": {
      "runtimeType": "io.containerd.kata.v2"
    }
  }
}
EOF
fi

echo "[kata] Restarting Docker..."
systemctl restart docker
sleep 2

# ── Test ───────────────────────────────────────────────────────────────
echo "[kata] Testing container..."
HOST_KERNEL=$(uname -r)
KATA_KERNEL=$(docker run --runtime=kata --rm ubuntu:24.04 uname -r 2>&1)

echo "[kata] Host kernel:  $HOST_KERNEL"
echo "[kata] Kata kernel:  $KATA_KERNEL"

if [ "$HOST_KERNEL" = "$KATA_KERNEL" ]; then
    echo "[kata] WARNING: kernels match — Kata may not be using microVM"
else
    echo "[kata] SUCCESS: different kernel confirms microVM isolation"
fi

# ── Cleanup ────────────────────────────────────────────────────────────
rm -f "/tmp/$TARBALL"

echo "[kata] Done. Use --runtime=kata with docker run."
echo "[kata] Example: docker run --runtime=kata --rm ubuntu:24.04 uname -r"
