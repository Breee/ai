# Reboot Prompt — 2026-08-30

## Where we left off

We're building an **agent identity sandbox** — isolated containers where agents get workload identity via SPIRE, secrets via OpenBao, and filesystem/network sandboxing via nono. The working stack is at `~/repos/github.com/Breee/ai/agent-sandbox/`.

### What's already working

1. **SPIRE + OpenBao JWT auth** — full chain works:
   - SPIRE server running on host:8081 (trust_domain=local)
   - OpenBao at 127.0.0.1:8201 with JWT auth configured (role: `agent-readonly`)
   - JWT-SVID fetched from SPIRE → OpenBao validates → VAULT_TOKEN issued
   - Test secret at `secret/data/test`: `{"api_key": "test-secret-12345"}`

2. **nono sandbox** — filesystem + network + IPC isolation working
   - Agent container runs with `--security-opt seccomp=unconfined` (required for Landlock)
   - IPC denials confirm sandbox is active

3. **Docker image** — `agent-sandbox:latest` built from `Dockerfile` (ubuntu:24.04 + SPIRE 1.15.2 + nono 0.74.0 + opencode)

### What we pivoted to

We moved from custom Docker containers to **agentcontainers** (https://github.com/kubedoll-heavy-industries/agentcontainers) — a Go project that provides:
- Docker-based agent isolation with eBPF enforcement
- Approval broker (human-in-the-loop gating)
- Sigstore image signing
- devcontainer.json format
- Vault/OpenBao integration examples
- Network egress control via cgroup-scoped BPF hooks

### What's built

- `/tmp/agentcontainer` — 25MB binary built from source
- `opencode-agent:latest` — Docker image (debian:trixie-slim + opencode 1.18.25)
- `examples/opencode/agentcontainer.json` — defines network egress, shell commands, filesystem limits for an opencode agent

### What needs to happen next

1. **Run `agentcontainer run`** with the opencode example to verify it works
2. **Test eBPF enforcer** — the Rust sidecar that does runtime syscall filtering
3. **Integrate with SPIRE+OpenBao** — agentcontainers has `examples/vault-openbao/` that shows Vault secrets provider integration
4. **Wire into opencode** — create a plugin or command that spawns isolated agents

### Key files

| File | Purpose |
|------|---------|
| `agent-sandbox/README.md` | Architecture, flow, agent profiles, status |
| `agent-sandbox/agent-entrypoint.sh` | SPIRE + nono + opencode bootstrap (working) |
| `agent-sandbox/Dockerfile` | Agent image with SPIRE + nono + opencode |
| `agent-sandbox/docker-compose.yaml` | OpenBao on :8201 (running) |
| `agent-sandbox/spire-server.conf` | SPIRE server config |
| `agent-sandbox/spire-agent.conf` | SPIRE agent config |
| `agent-sandbox/install-kata.sh` | Kata installer (not yet run) |

### Infrastructure running

- `spire-server` on host:8081 (trust_domain=local)
- `sandbox-openbao` at 127.0.0.1:8201 (root token: `sandbox-root-token`)
- SPIRE workload entry: `spiffe://local/agent/readonly` (selector: `unix:uid:0`)

### Hardware

- AMD Ryzen 7 PRO 6850U, 29GB RAM, no GPU
- gVisor installed but incompatible with nono (no Landlock ABI)
- Kata not installed (installer script ready)
- KVM available (/dev/kvm)

### npm broken

npm is broken on Node v24/v26 (minipass version conflict). Cannot install npm packages. Go and Python work fine.
