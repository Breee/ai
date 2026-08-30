#!/bin/bash
set -euo pipefail

# agent-entrypoint.sh — Wire SPIRE identity + nono sandbox + opencode
#
# Environment:
#   SPIRE_SERVER_ADDR   — SPIRE server address (default: spire-server:8081)
#   AGENT_ID            — Agent identity path (default: /agent/default)
#   WORKSPACE           — Workspace path (default: /workspace)
#   OPENCODE_ARGS       — Extra args for opencode

SPIRE_SERVER_ADDR="${SPIRE_SERVER_ADDR:-spire-server:8081}"
AGENT_ID="${AGENT_ID:-/agent/default}"
WORKSPACE="${WORKSPACE:-/workspace}"

echo "[agent] Starting with identity: ${AGENT_ID}"
echo "[agent] SPIRE server: ${SPIRE_SERVER_ADDR}"

# 1. Bootstrap SPIRE agent identity
#    The SPIRE agent join token is mounted at /run/spire/join-token
if [ -f /run/spire/join-token ]; then
    JOIN_TOKEN=$(cat /run/spire/join-token)
    echo "[agent] Bootstrapping SPIRE agent with join token..."

    # Start SPIRE agent in background
    /opt/spire/bin/spire-agent run \
        -config /etc/spire/agent.conf \
        -joinToken "${JOIN_TOKEN}" &
    SPIRE_PID=$!

    # Wait for SPIRE agent to be ready
    for i in $(seq 1 30); do
        if /opt/spire/bin/spire-agent healthcheck 2>/dev/null; then
            echo "[agent] SPIRE agent ready"
            break
        fi
        sleep 1
    done

    # Fetch SVID (workload identity)
    echo "[agent] Fetching SVID for ${AGENT_ID}..."
    /opt/spire/bin/spire-agent api fetch x509 \
        -socketPath /tmp/spire/sockets/agent.sock \
        -write /tmp/svid \
        -spiffeID "spiffe://local/agent${AGENT_ID}" 2>/dev/null || true

    if [ -f /tmp/svid/svid.0.pem ]; then
        echo "[agent] SVID acquired"
        export SPIFFE_SVID_CERT=/tmp/svid/svid.0.pem
        export SPIFFE_SVID_KEY=/tmp/svid/svid.0.key
        export SPIFFE_BUNDLE=/tmp/svid/bundle.0.pem
    else
        echo "[agent] WARNING: SVID fetch failed, continuing without SPIRE identity"
    fi
else
    echo "[agent] No join token found, skipping SPIRE bootstrap"
fi

# 2. Build nono profile for this agent
NONO_PROFILE="/tmp/agent-profile.json"
mkdir -p "${WORKSPACE}" /tmp /root/.local/share/opencode/log /root/.config/opencode /root/.local/state/opencode /root/.cache
cat > "${NONO_PROFILE}" <<EOF
{
  "meta": {
    "name": "opencode-agent",
    "version": "1.0.0"
  },
  "groups": {
    "include": [
      "system_read_linux_core",
      "system_write_linux",
      "user_caches_linux"
    ]
  },
  "workdir": {
    "access": "readwrite"
  },
  "filesystem": {
    "allow": ["/workspace", "~/.local/share/opencode", "~/.cache", "/\$bunfs"],
    "write": ["/tmp", "~/.local/state/opencode"],
    "deny": ["~/.ssh", "~/.gnupg", "~/.aws", "~/.kube", "/run/spire", "/etc/spire"]
  },
  "network": {
    "allow_domain": [
      "api.openai.com",
      "api.anthropic.com",
      "openrouter.ai",
      "opencode.ai"
    ]
  }
}
EOF

# 3. Start opencode inside nono sandbox
#    Use 'run' mode (headless) since there's no TTY in the container
echo "[agent] Launching opencode in sandbox..."
if [ -n "${PROMPT:-}" ]; then
    exec /usr/local/bin/nono run \
        --profile "${NONO_PROFILE}" \
        --allow-cwd \
        -- opencode run "${PROMPT}"
else
    exec /usr/local/bin/nono run \
        --profile "${NONO_PROFILE}" \
        --allow-cwd \
        -- opencode serve
fi
