# Agent Identity Sandbox

Containerized AI agents with SPIFFE/SPIRE workload identity, nono secret brokering, and OpenBao secrets — all running locally on Docker.

## Goal

Spawn isolated agent containers where:
- Agent never holds credentials (nono brokers them per-invocation)
- Identity is attested, not self-asserted (SPIRE SVID)
- Secrets are short-lived and auto-rotating
- Filesystem, network, and execution are sandboxed

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Host                                    │
│                                                 │
│  ┌─────────────┐  ┌──────────────┐             │
│  │ spire-server │  │  openbao     │             │
│  │ (CA + SVIDs) │  │ (secrets)    │             │
│  └──────┬──────┘  └──────┬───────┘             │
│         │                │                      │
│  ┌──────┴──────┐         │                      │
│  │ spire-agent │         │                      │
│  │ (attests)   │         │                      │
│  └──────┬──────┘         │                      │
│         │ UDS socket     │                      │
│  ┌──────┴───────────────┐│                      │
│  │   nono proxy         ││                      │
│  │   (broker + inject)  │◄┘ JWT auth via JWKS   │
│  └──────┬───────────────┘                       │
│         │                                        │
│  ┌──────┴───────────────┐                       │
│  │  agent container     │                       │
│  │  (opencode + nono)   │                       │
│  │  - gVisor runtime    │                       │
│  │  - cgroup limits     │                       │
│  │  - no credentials    │                       │
│  └──────────────────────┘                       │
└─────────────────────────────────────────────────┘
```

## Flow

1. Agent starts → nono proxy boots first (parent process)
2. nono connects to SPIRE → gets JWT-SVID for this workload
3. Agent needs secret → sends plain request to `localhost`
4. nono intercepts → injects JWT-SVID as bearer token → forwards to OpenBao
5. OpenBao validates → SPIRE JWKS endpoint → issues scoped token → returns secret
6. Agent never sees → SVID, vault token, or raw secret

## Components

### SPIRE (Identity CA)

- **Server**: Issues SVIDs, maintains trust bundle
- **Agent**: Attests workloads, serves SVIDs via Unix Domain Socket
- **Attestation**: docker:label, binary hash, unix uid (local is weaker than K8s)

### nono (Secret Broker)

- Proxy-based credential injection per invocation
- JWT-SVID fetched at startup, injected per request, zeroed after use
- Filesystem sandbox (deny-by-default)
- Network sandbox (host allowlist)
- Agent never sees credentials

### OpenBao (Secrets Store)

- JWT auth method configured with SPIRE JWKS
- Policies per agent role (reader, writer, gitlab, etc.)
- Short-lived tokens, auto-rotating

### Agent Container

- gVisor runtime (kernel-level isolation)
- cgroup limits (CPU, RAM, PIDs)
- cap-drop=ALL, no-new-privileges
- Workspace mounted r/o or r/w
- No credentials in env vars or files

## Agent Profiles

| # | Agent | Identity | Secrets | Network | Mounts |
|---|-------|----------|---------|---------|--------|
| 1 | readonly-all | SPIRE SVID | none | gitlab, github | repos r/o |
| 2 | readonly-gitlab | SPIRE SVID | OpenBao: shared/gitlab (read) | gitlab only | repos r/o |
| 3 | readonly-k8s | SPIRE SVID | OpenBao: k8s/* (kubeconfig) | k8s API | none |
| 4 | readonly-k8s-scoped | SPIRE SVID | OpenBao: k8s/<ns> | k8s API (ns only) | none |
| 5 | write-gitlab | SPIRE SVID | OpenBao: shared/gitlab (write) | gitlab only | repos r/w |
| 6 | write-k8s | SPIRE SVID | OpenBao: k8s/* (write SA) | k8s API | none |
| 7 | read-docker | SPIRE SVID | none | docker daemon | docker.sock r/o |
| 8 | write-docker | SPIRE SVID | none | docker daemon | docker.sock r/w |

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yaml` | All services: spire-server, spire-agent, openbao |
| `docker-compose.agent.yaml` | Agent container template |
| `spire-server.conf` | SPIRE server config |
| `spire-agent.conf` | SPIRE agent config |
| `Dockerfile` | Agent container image |
| `agent-entrypoint.sh` | Wires SPIRE + nono + opencode |
| `openbao/` | Vault policies, secrets config |
| `nono/` | Agent profiles, credential routes |
| `opencode-plugin/` | Glue to spawn agents from opencode |

## Research

### SPIRE on Docker

- Official quickstart: join-token attestation, unix workload attestor
- Docker workload attestor: matches on labels, image, uid
- Binary hash attestor: stronger, matches on sha256 of binary
- JWT-SVID: short-lived token, auto-rotating, scoped to audience
- X.509-SVID: certificate for mTLS, rotates atomically

### nono SPIFFE Integration

- PR #1272 merged: JWT-SVID injection via proxy
- Proxy fetches SVID at startup, caches, refreshes before expiry
- SVID private key never written to disk or logged
- Fail-closed: no identity, no session
- Audit trail: sequence-numbered, hash-chained, Merkle-committed

### OpenBao JWT Auth

- Enable: `vault auth enable jwt`
- Configure: JWKS URL pointing to SPIRE OIDC discovery provider
- Role: bound_subject (SPIFFE ID), bound_audiences, user_claim=sub
- Login: `vault write auth/jwt/login role=r1 jwt=$JWT`
- Token has policies based on role

### Getting Started Reference

- `github.com/mweigel/getting-started-spire-openbao` — minimal working example
- SPIRE server → OIDC provider → OpenBao JWT auth → secrets retrieval
- Bash scripts, copy-paste ready

## Known Issues

### Docker Socket = Full Host Access
Mounting /var/run/docker.sock grants root-equivalent host access.
**Fix**: Docker API proxy with RBAC, or sidecar that mediates Docker calls.

### SPIRE Docker Attestation is Self-Asserted
Docker workload attestor matches on labels/image/uid — set by whoever builds the container.
**Fix**: Binary hash attestor (sha256 of the binary).

### Docker Network ≠ Egress Control
Docker networks control inter-container traffic but NOT egress to host/internet.
**Fix**: iptables default-deny egress + forward proxy.

### Env Var Secret Leakage
--env puts secrets in /proc/<pid>/environ, docker inspect, logs.
**Fix**: Inject via tmpfs at /run/secrets/ or fetch at runtime via SVID→OpenBao.

### OpenBao Auth Circular Dependency
Agent needs credentials to fetch credentials from OpenBao.
**Fix**: JWT/SVID auth method (SPIRE SVID → OpenBao).

### Plugin as Single Point of Failure
Plugin holds SVID/token in process memory.
**Fix**: Per-invocation brokering (nono pattern).

## Implementation Options

### Option A: Simple (MVP)
- Docker containers + runc
- SPIRE with docker:label attestor
- Env vars for tokens
- Docker networks for isolation
- **Time**: 1-2 days
- **Weakness**: No real sandbox, weak attestation, env var leakage

### Option B: Medium (Recommended)
- Docker containers + gVisor runtime
- SPIRE with docker:label + binary hash attestor
- SVID → OpenBao JWT auth for secrets
- iptables egress + forward proxy
- **Time**: 3-5 days
- **Strength**: Good isolation, real identity, proper secrets

### Option C: Hard
- Docker containers + gVisor/Kata
- SPIRE with multiple attestors
- SVID → OpenBao JWT auth
- eBPF per-binary network policy
- Landlock filesystem allowlisting
- Sigstore image verification
- **Time**: 1-2 weeks
- **Strength**: Production-grade, state of the art

### Option D: bleeding edge — agentcontainers (in progress)
- [agentcontainers](https://github.com/kubedoll-heavy-industries/agentcontainers) — Go, Docker-based, eBPF enforcement, approval broker, Sigstore signing, devcontainer.json format
- Built binary: `/tmp/agentcontainer` (25MB, from source)
- Built image: `opencode-agent:latest` (debian:trixie-slim + opencode 1.18.25)
- `agentcontainer.json` defines network egress, shell commands, filesystem limits
- Has Vault/OpenBao integration examples (`examples/vault-openbao/`)
- eBPF enforcer sidecar for runtime syscall filtering
- Next: run `agentcontainer run`, test eBPF, integrate with SPIRE+OpenBao

## Quick Start

### Infrastructure

```bash
# Existing SPIRE server (host:8081) and OpenBao (host:8201) are reused.
# OpenBao JWT auth already configured with SPIRE JWKS.

# Verify SPIRE entries
docker exec spire-server /opt/spire/bin/spire-server entry show

# Verify OpenBao health
curl -s http://127.0.0.1:8201/v1/sys/health
```

### Build the agent image

```bash
docker build -t agent-sandbox:latest .
```

### Spawn an agent

```bash
# 1. Generate a fresh join token (single-use!)
JOIN_TOKEN=$(docker exec spire-server /opt/spire/bin/spire-server token generate -spiffeID spiffe://local/host 2>&1 | awk '{print $2}')
echo -n "$JOIN_TOKEN" > /tmp/spire-test-join-token

# 2. Run agent with SPIRE identity + OpenBao secrets + nono sandbox
docker run --rm \
  --name agent \
  --hostname agent \
  --label org.example.name=agent-readonly \
  --network host \
  --cpus 1.0 --memory 1g --pids-limit 256 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt seccomp=unconfined \
  -e AGENT_ID=/agent/readonly \
  -e OPENBAO_ADDR=http://127.0.0.1:8201 \
  -e JWT_ROLE=agent-readonly \
  -e PROMPT="echo the value of VAULT_TOKEN env var" \
  -v /tmp/spire-test-join-token:/run/spire/join-token:ro \
  -v /tmp/spire/sockets:/tmp/spire/sockets \
  -v /tmp/spire-trust-bundle.crt:/etc/spire/bundle.crt:ro \
  agent-sandbox:latest
```

**Expected output:**
```
[agent] Starting with identity: /agent/readonly
[agent] Bootstrapping SPIRE agent...
[agent] Waiting for workload API...
[agent] Workload API ready (6s)
[agent] Authenticating to OpenBao (role=agent-readonly)...
[agent] OpenBao authenticated, policies: agent-readonly, default
[agent] Launching opencode in sandbox...
> build · big-pickle
$ echo "$VAULT_TOKEN"
s.pFrcApT1SO4PbvwgLV6S5WJr
```

### Verifying isolation

```bash
# Inside agent container, nono blocks:
# - IPC denials for unix sockets (nscd, D-Bus)
# - External directory access (/etc, ~/.ssh, etc.)
# - Network restricted to allowlisted domains
# - Filesystem deny-by-default

# VAULT_TOKEN is available to opencode as an env var.
# SPIRE SVID is cached at /tmp/spire/sockets/agent.sock.
```

## Success Criteria

- [x] Agent container starts with SPIRE identity
- [x] OpenBao authenticates via JWT-SVID
- [x] VAULT_TOKEN exported and readable inside sandbox
- [x] nono sandbox applied (filesystem + network + IPC isolation)
- [x] IPC denials confirm active blocking
- [x] agentcontainers built from source (`/tmp/agentcontainer`)
- [x] `opencode-agent` Docker image built
- [ ] Agent cannot escape sandbox (needs gVisor — currently runc)
- [ ] Audit trail for all credential access
- [ ] OpenCode plugin to spawn agents from TUI
- [ ] iptables default-deny egress
- [ ] Per-agent nono profiles with different access levels
- [ ] `agentcontainer run` working end-to-end
- [ ] eBPF enforcer functional
- [ ] agentcontainers + SPIRE+OpenBao integration
