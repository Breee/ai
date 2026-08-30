# AGENTS.md

## What this is

Containerized AI agents with workload identity, secrets, and sandboxing. Uses SPIRE for identity, OpenBao for secrets, and agentcontainers for isolation.

## Current state (2026-08-30)

**Working**: SPIRE → JWT-SVID → OpenBao auth → VAULT_TOKEN, nono sandbox (filesystem/network/IPC), Docker image with SPIRE+nono+opencode.

**Pivoted to**: [agentcontainers](https://github.com/kubedoll-heavy-industries/agentcontainers) — Go, Docker-based, eBPF enforcement, approval broker, devcontainer.json format.

**Binary**: `/tmp/agentcontainer` (25MB, built from source)
**Image**: `opencode-agent:latest` (debian:trixie-slim + opencode 1.18.25)

## Infrastructure

| Service | Address | Status |
|---------|---------|--------|
| spire-server | host:8081 | running (trust_domain=local) |
| sandbox-openbao | 127.0.0.1:8201 | running (root token: sandbox-root-token) |
| SPIRE entry | spiffe://local/agent/readonly | selector: unix:uid:0 |
| OpenBao JWT role | agent-readonly | bound_subject: spiffe://local/agent/readonly |

## Next steps

1. Run `agentcontainer run` with opencode example
2. Test eBPF enforcer
3. Integrate with SPIRE+OpenBao
4. Wire into opencode as a command/plugin

## See also

- `REBOOT-PROMPT.md` — full context for resuming work
- `README.md` — architecture, flow, agent profiles
