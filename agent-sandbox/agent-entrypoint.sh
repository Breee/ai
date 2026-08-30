#!/bin/bash
set -euo pipefail

# agent-entrypoint.sh — Wire SPIRE identity + nono sandbox + opencode
#
# Environment:
#   SPIRE_SERVER_ADDR   — SPIRE server address (default: host.docker.internal:8081)
#   AGENT_ID            — Agent identity path (default: /agent/default)
#   WORKSPACE           — Workspace path (default: /workspace)
#   OPENBAO_ADDR        — OpenBao address (default: http://127.0.0.1:8201)
#   JWT_ROLE            — OpenBao JWT auth role (default: agent-readonly)
#   PROMPT              — If set, run opencode with this prompt (headless)

SPIRE_SERVER_ADDR="${SPIRE_SERVER_ADDR:-host.docker.internal:8081}"
AGENT_ID="${AGENT_ID:-/agent/default}"
WORKSPACE="${WORKSPACE:-/workspace}"
OPENBAO_ADDR="${OPENBAO_ADDR:-http://127.0.0.1:8201}"
JWT_ROLE="${JWT_ROLE:-agent-readonly}"

SOCKET="/tmp/spire/sockets/agent.sock"

echo "[agent] Starting with identity: ${AGENT_ID}"
echo "[agent] SPIRE server: ${SPIRE_SERVER_ADDR}"

# ── 1. Bootstrap SPIRE agent ──────────────────────────────────────────
if [ -f /run/spire/join-token ]; then
    JOIN_TOKEN=$(cat /run/spire/join-token)
    echo "[agent] Bootstrapping SPIRE agent..."

    /opt/spire/bin/spire-agent run \
        -config /etc/spire/agent.conf \
        -joinToken "${JOIN_TOKEN}" 2>/dev/null &
    SPIRE_PID=$!

    # Wait for workload API: retry JWT fetch until it returns a token
    echo "[agent] Waiting for workload API..."
    JWT=""
    for i in $(seq 1 30); do
        JWT_RAW=$(/opt/spire/bin/spire-agent api fetch jwt \
            -socketPath "${SOCKET}" \
            -audience openbao 2>/dev/null) || true
        JWT=$(echo "$JWT_RAW" | awk '/^token\(spiffe/{getline; gsub(/^\t/, ""); print; exit}')
        if [ ${#JWT} -gt 10 ]; then
            echo "[agent] Workload API ready (${i}s)"
            break
        fi
        sleep 1
    done

    if [ ${#JWT} -le 10 ]; then
        echo "[agent] WARNING: Workload API not ready after 30s, continuing without SPIRE"
    fi

    # ── 2. Authenticate to OpenBao via JWT-SVID ───────────────────────
    if [ ${#JWT} -gt 10 ]; then
        echo "[agent] Authenticating to OpenBao (role=${JWT_ROLE})..."
        RESP=$(curl -s -X POST "${OPENBAO_ADDR}/v1/auth/jwt/login" \
            -H "Content-Type: application/json" \
            -d "{\"role\": \"${JWT_ROLE}\", \"jwt\": \"${JWT}\"}")

        VAULT_TOKEN=$(echo "$RESP" | jq -r ".auth.client_token // empty" 2>/dev/null) || true
        if [ -n "$VAULT_TOKEN" ]; then
            export VAULT_ADDR="${OPENBAO_ADDR}"
            export VAULT_TOKEN
            echo "[agent] OpenBao authenticated, policies: $(echo "$RESP" | jq -r '.auth.policies | join(", ")')"
        else
            echo "[agent] WARNING: OpenBao auth failed"
        fi
    fi
else
    echo "[agent] No join token, skipping SPIRE bootstrap"
fi

# ── 3. Build nono sandbox profile ─────────────────────────────────────
NONO_PROFILE="/tmp/agent-profile.json"
mkdir -p "${WORKSPACE}" /tmp \
    /root/.local/share/opencode/log \
    /root/.config/opencode \
    /root/.local/state/opencode \
    /root/.cache

cat > "${NONO_PROFILE}" <<'EOF'
{
  "meta": { "name": "opencode-agent", "version": "1.0.0" },
  "groups": {
    "include": [
      "system_read_linux_core",
      "system_write_linux",
      "user_caches_linux"
    ]
  },
  "workdir": { "access": "readwrite" },
  "filesystem": {
    "allow": ["/workspace", "~/.local/share/opencode", "~/.cache", "/$bunfs"],
    "write": ["/tmp", "~/.local/state/opencode"],
    "deny": ["~/.ssh", "~/.gnupg", "~/.aws", "~/.kube", "/run/spire", "/etc/spire"]
  },
  "network": {
    "allow_domain": [
      "127.0.0.1",
      "localhost",
      "api.openai.com",
      "api.anthropic.com",
      "openrouter.ai",
      "opencode.ai"
    ]
  }
}
EOF

# ── 4. Launch opencode in sandbox ──────────────────────────────────────
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
