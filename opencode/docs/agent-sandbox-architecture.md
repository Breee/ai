# Agent Sandbox Architecture

## Goal

Spawn containerized/sandboxed opencode agents with:
- Verifiable identity (not self-asserted)
- Scoped secret access (agent never holds credentials)
- Filesystem, network, execution, and tool restrictions
- Subagent spawning controls

## 8 Agent Profiles

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

## Proposed Stack

```
Docker Compose (3 services)
├── spire-server    (CA, registration entries)
├── spire-agent     (attests workloads, serves SVIDs via UDS)
└── openbao         (secrets store, JWT auth from SPIRE)

Agent Container (per task)
├── Runtime: gVisor (runsc) or plain runc
├── Identity: SPIRE SVID (docker:label or binary hash attestor)
├── Secrets: SVID → OpenBao JWT auth → fetch at runtime
├── Network: iptables default-deny + forward proxy
├── Filesystem: Landlock allowlist or read-only mounts
└── Resources: cgroup limits (CPU, RAM, pids)
```

## Flow

```
1. Plugin reads agent markdown config
2. Plugin registers workload with SPIRE (selectors: label, uid, binary)
3. Plugin starts container with:
   - SPIRE agent socket mounted (/run/spire/sockets/agent.sock)
   - Workspace volume mounted (r/o or r/w)
   - Network restricted (forward proxy or iptables)
   - Resource limits (cgroups)
   - Sandboxed runtime (gVisor or runc)
4. Agent starts → fetches SVID from SPIRE agent → gets X.509 cert or JWT
5. Agent needs secret → presents JWT-SVID to OpenBao → policy check → value returned
6. Agent never sees: SVID private key, vault token, other secrets
7. Task done → container dies → SVID expires → secrets gone
```

## Problems Identified

### 1. Docker Socket = Full Host Access
Mounting /var/run/docker.sock grants root-equivalent host access.
"Read-only" distinction is meaningless — can create privileged container, mount host fs, steal all secrets.
**Fix:** Docker API proxy with RBAC, or sidecar that mediates Docker calls.
**Profiles affected:** read-docker, write-docker

### 2. SPIRE Docker Attestation is Self-Asserted
Docker workload attestor matches on labels/image/uid — set by whoever builds the container.
Malicious image with correct label = same SVID.
**Fix:** Binary hash attestor (sha256 of the binary), or K8s SAT for cluster deployments.
**Impact:** Local SPIRE is weaker than K8s SPIRE.

### 3. Docker Network ≠ Egress Control
Docker networks control inter-container traffic but NOT egress to host/internet.
Container on agent-net can still reach api.openai.com, evil.com, etc.
**Fix:** iptables default-deny egress + forward proxy (Envoy/Squid) with domain allowlist.
**Alternative:** eBPF hooks (OpenShell/Containarium approach).

### 4. Env Var Secret Leakage
--env puts secrets in /proc/<pid>/environ, docker inspect, logs, process table.
**Fix:** Inject via tmpfs at /run/secrets/ (Docker secrets pattern), or fetch at runtime via SVID→OpenBao.

### 5. OpenBao Auth Circular Dependency
Agent needs credentials to fetch credentials from OpenBao.
Options:
- AppRole: static role_id + secret_id (another secret)
- K8s auth: needs SA token (only in-cluster)
- JWT/SVID: SPIRE SVID as JWT → OpenBao validates against SPIRE JWKS (clean path)
**Fix:** JWT auth method. OpenBao trusts SPIRE's JWKS endpoint.

### 6. Plugin as Single Point of Failure
Plugin holds SVID/token in process memory. Compromised plugin = all credentials exposed.
**Fix:** Per-invocation brokering (nono pattern). Plugin gets JWT-SVID scoped to ONE audience, uses ONCE, zeros. Never holds long-lived credential.

### 7. No Runtime Integrity Verification
Who verifies the container image? Malicious image = same SPIRE identity.
**Fix:** Sigstore/cosign image signing, OCI digest pinning, Landlock filesystem allowlisting.

### 8. Subagent Spawning has No Limits
Agent can DoS host by creating hundreds of containers.
**Fix:** Resource quotas (max containers, CPU, RAM), TTL on subagents, approval gate.

## State of the Art Comparison

| Project | Identity | Isolation | Secrets | Network | Policy |
|---------|----------|-----------|---------|---------|--------|
| Kagenti (Red Hat) | SPIFFE/SPIRE | K8s pods + Istio | SVID → OAuth2 | Istio mTLS + NetworkPolicy | Namespace-level |
| nono | SPIFFE JWT-SVID | Per-invocation broker | Phantom tokens (zeroed) | HTTP CONNECT proxy | Audit + hash chain |
| Google ADK | HW-backed signing keys | gVisor | KMS envelope | Semantic gateway | Deterministic I/O gates |
| OpenShell (Red Hat) | SPIFFE | Landlock + per-binary eBPF | Credential-free routing | HTTP CONNECT + /proc | OPA/Rego per-binary |
| agentcontainers | Sigstore | Docker + eBPF enforcer | tmpfs + Vault/KMS | cgroup BPF hooks | Approval broker |
| Containarium | SSH-native | LXC or K8s | KMS envelope | eBPF egress | JWT scopes + RBAC |
| Precinct | SPIFFE/SPIRE | gVisor/Kata RuntimeClass | SPIRE SVID | mTLS | OPA/Cedar |

## Industry Consensus (2026)

1. **Docker alone is not a security boundary** for untrusted code. Need gVisor, Kata, or Firecracker.
2. **SPIRE is strongest in K8s** (SAT attestation). Locally, need binary hash or additional attestors.
3. **Network egress is the #1 overlooked control.** Default-deny + forward proxy is table stakes.
4. **Short-lived credentials > static secrets.** SPIRE SVID rotation (hourly) bounds blast radius.
5. **Per-binary/per-process policy** is the frontier (OpenShell, Containarium, agentcontainers).
6. **Prompt integrity is the weakest layer.** Infrastructure controls (isolation, network, secrets) must be independent of LLM compliance.

## Implementation Options

### Option A: Simple (MVP)
- Docker containers + runc
- SPIRE with docker:label attestor
- Env vars for tokens (quick and dirty)
- Docker networks for isolation
- **Time:** 1-2 days
- **Weakness:** No real sandbox, weak attestation, env var leakage

### Option B: Medium
- Docker containers + gVisor runtime
- SPIRE with docker:label + binary hash attestor
- SVID → OpenBao JWT auth for secrets
- iptables egress + forward proxy
- **Time:** 3-5 days
- **Strength:** Good isolation, real identity, proper secrets

### Option C: Hard
- Docker containers + gVisor/Kata
- SPIRE with multiple attestors
- SVID → OpenBao JWT auth
- eBPF per-binary network policy (OpenShell pattern)
- Landlock filesystem allowlisting
- Sigstore image verification
- Approval broker for subagent spawning
- **Time:** 1-2 weeks
- **Strength:** Production-grade, state of the art

## Recommendation

Start with **Option B**. It addresses the real problems (isolation, identity, secrets, network) without the operational complexity of eBPF/Landlock. Upgrade to Option C incrementally as threat model matures.

Key decisions needed:
1. gVisor or plain runc for MVP? (gVisor = better isolation, ~10-30% overhead)
2. Forward proxy or iptables for egress? (forward proxy = auditable, domain-aware)
3. SPIRE attestor: docker:label only, or add binary hash?
