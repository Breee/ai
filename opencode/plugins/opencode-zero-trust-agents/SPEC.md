# Spec: opencode-zero-trust-agents

Zero-knowledge agent identity and secret management for OpenCode.

## Vision

Every opencode agent gets a cryptographic identity, scoped secret access, and
audit trail — without ever holding a credential the agent can exfiltrate.

## Identity Model (Refined)

### Identity Sources (Layered)

```
┌─────────────────────────────────────────────────────────────┐
│ Source 1: SPIRE SVID (preferred)                            │
│                                                             │
│ - Cryptographic workload identity (X.509 or JWT)            │
│ - Attested by platform (not self-asserted)                  │
│ - Short-lived (hourly rotation)                             │
│ - Works across K8s, Docker, bare metal                      │
├─────────────────────────────────────────────────────────────┤
│ Source 2: K8s ServiceAccount (fallback for cluster)         │
│                                                             │
│ - Platform-attested identity                                │
│ - Auto-mounted token (1-hour expiry)                        │
│ - RBAC enforced by API server                               │
│ - Scoped to namespace                                       │
├─────────────────────────────────────────────────────────────┤
│ Source 3: Static Token (legacy, last resort)                │
│                                                             │
│ - Operator-created, scoped to policy                        │
│ - Stored in ~/.vault-tokens/<role> (chmod 600)             │
│ - No auto-rotation (manual renewal)                         │
│ - Weakest: no platform attestation                          │
└─────────────────────────────────────────────────────────────┘
```

### Identity Scoping

| Scope | Mechanism | Effect |
|-------|-----------|--------|
| **Path** | Vault policy | Agent can only read specific secret paths |
| **Time** | Token TTL | Tokens expire after N hours (SPIRE: 1h, K8s: 1h) |
| **Audience** | JWT `aud` claim | Token only valid for specific services |
| **Action** | RBAC verbs | read/write/delete scoped per agent |
| **Namespace** | K8s namespace | Cluster operations scoped to ai-agents |

### Identity Lifecycle

```
1. Registration
   Operator creates agent profile → SPIRE entry or K8s SA
   ↓
2. Attestation
   Workload starts → platform verifies identity (SPIRE attestor or K8s API)
   ↓
3. Token Issuance
   SVID issued (SPIRE) or SA token mounted (K8s)
   ↓
4. Secret Access
   Agent calls vault_get(path) → plugin validates identity → fetches secret
   ↓
5. Rotation
   SPIRE: automatic hourly rotation
   K8s: projected service account token with short expiry
   Static: manual operator action
   ↓
6. Revocation
   Agent container dies → SVID expires → access revoked
   Or: operator deletes SA / revokes token
```

### Identity Verification

| Check | Who | When |
|-------|-----|------|
| SVID validity | OpenBao | Every vault request |
| Token expiry | Plugin | Every vault request |
| Path policy | OpenBao | Every vault request |
| File permissions | Plugin | Token file read |
| Agent role | Plugin | Request context |

## Problem Statement

```
Current state:
  Agent → reads token file → calls vault API → gets secret
  Agent holds: token, secret, full vault access
  Blast radius: everything the token can do

Desired state:
  Agent → calls vault_get("shared/gitlab") → plugin mediates → returns value
  Agent holds: nothing (value is ephemeral in context)
  Blast radius: one path, one secret, one invocation
```

## Three Layers of Trust

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: IDENTITY (who are you?)                            │
│                                                             │
│ SPIRE SVID (preferred) or K8s ServiceAccount                │
│ Attested by platform, not self-asserted                     │
│ Short-lived, auto-rotating                                  │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: SECRETS (what can you access?)                     │
│                                                             │
│ OpenBao policies → per-role path scoping                    │
│ reader: secret/readonly/*                                   │
│ k8s-readonly: secret/k8s/*, secret/shared/*                 │
│ Plugin mediates: agent never sees token                     │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: SANDBOX (what can you do?)                         │
│                                                             │
│ OpenCode permissions → per-agent tool restrictions          │
│ Agent markdown denies: read vault files, curl vault         │
│ Plugin is the ONLY path to secrets                          │
└─────────────────────────────────────────────────────────────┘
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ OpenCode Agent                                              │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Agent Config (reader.md, k8s-writer.md, etc.)          │ │
│ │                                                         │ │
│ │ identity:                                               │ │
│ │   source: spire | k8s-sa | static                      │ │
│ │   role: reader | k8s-writer | gitlab-writer             │ │
│ │ permission:                                             │ │
│ │   read:                                                 │ │
│ │     "~/.vault-tokens/*": deny  ← blocks direct access  │ │
│ │     "*vault*": deny                                     │ │
│ │   bash:                                                 │ │
│ │     "curl *vault*": deny  ← blocks raw API calls       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Can call: vault_get, vault_list, vault_status               │
│ Cannot:   read token files, curl vault, env vars            │
└──────────────────────┬──────────────────────────────────────┘
                       │ tool call (path only, no token)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ opencode-zero-trust-agents Plugin                           │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Identity Store (process memory only)                    │ │
│ │                                                         │ │
│ │ 1. Try SPIRE: fetch SVID from UDS socket               │ │
│ │ 2. Fallback K8s: read SA token from projected volume    │ │
│ │ 3. Fallback static: read from ~/.vault-tokens/<role>   │ │
│ │                                                         │ │
│ │ - Never serialize to agent context                      │ │
│ │ - Never log token value                                 │ │
│ │ - Auto-rotate before expiry                             │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ 1. Resolve identity (SPIRE → K8s → static)                 │
│ 2. Validate token (expiry, audience, path policy)          │
│ 3. Fetch from OpenBao API                                   │
│ 4. Audit-log: {agent, path, timestamp, status}              │
│ 5. Return value only (no token, no metadata)                │
└──────────────────────┬──────────────────────────────────────┘
                       │ X-Vault-Token: <internal>
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ OpenBao (vault.localhost)                                   │
│                                                             │
│ Policies enforce per-role access:                           │
│   reader → secret/readonly/* only                           │
│   k8s-readonly → secret/k8s/*, secret/shared/*              │
│   gitlab-writer → secret/shared/gitlab only                 │
│                                                             │
│ Even if token leaks: scoped to limited paths                │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Agent Identity (Layered Sources)

Each agent has a primary identity source with fallbacks:

| Agent | Primary Identity | Fallback | K8s RBAC | Vault Policy |
|-------|-----------------|----------|----------|--------------|
| `reader` | SPIRE SVID | K8s SA `ai-agents/reader` | Read-only (secrets, configmaps, pods) | `agent-reader` |
| `k8s-writer` | SPIRE SVID | K8s SA `ai-agents/k8s-writer` | Full CRUD (pods, services, deployments) | `agent-k8s-readonly` |
| `gitlab-writer` | SPIRE SVID | Static token | None | `agent-gitlab` |

**Identity Resolution Order:**
1. **SPIRE SVID** — fetch from local SPIRE agent UDS socket
2. **K8s SA** — read projected service account token
3. **Static token** — read from `~/.vault-tokens/<role>` (last resort)

**Why layered identity?**
- SPIRE works across K8s, Docker, bare metal (portable)
- K8s SA is fallback for cluster-only workloads
- Static token is last resort for legacy/migration
- Plugin tries each source in order, uses first available

### 2. Secret Storage (OpenBao)

Vault with per-role policies:

```hcl
# agent-reader: code/config access only
path "secret/data/readonly/*" { capabilities = ["read"] }
path "secret/metadata/readonly/*" { capabilities = ["list"] }
path "secret/*" { capabilities = ["deny"] }

# agent-k8s-readonly: K8s + shared creds
path "secret/data/k8s/*" { capabilities = ["read"] }
path "secret/data/shared/*" { capabilities = ["read"] }
path "secret/metadata/shared/*" { capabilities = ["list"] }
path "secret/*" { capabilities = ["deny"] }

# agent-gitlab: GitLab only
path "secret/data/shared/gitlab" { capabilities = ["read"] }
path "secret/metadata/shared/*" { capabilities = ["list"] }
path "secret/*" { capabilities = ["deny"] }
```

### 3. Zero-Knowledge Plugin

The plugin is the ONLY path from agent to secrets.

**Token lifecycle:**
```
Operator creates scoped token
    ↓
Saved to ~/.vault-tokens/<role> (chmod 600)
    ↓
Plugin reads at startup (once)
    ↓
Held in process memory (never leaves)
    ↓
Agent calls vault_get(path) → plugin fetches → returns value
    ↓
Value is ephemeral in agent context (can be logged, but token cannot)
```

**What the plugin does:**
- Reads token file at init (not per-request)
- Validates path against allowlist (defense-in-depth)
- Fetches from vault API using internal token
- Audit-logs every access
- Returns only the value

**What the plugin does NOT do:**
- Create tokens (operator does this)
- Renew tokens (v2 feature)
- Expose token to agent (ever)
- Log secret values

### 4. Permission Rules (Defense-in-Depth)

Agent markdown files deny direct vault access:

```yaml
permission:
  read:
    "~/.vault-tokens/*": deny
    "*vault*": deny
    ".vault-tokens": deny
  bash:
    "curl *vault*": deny
    "vault *": deny
    "cat *vault*": deny
    "env | grep -i vault": deny
    "printenv | grep -i vault": deny
```

## Tools

### `vault_get(path, key?)`

Read a secret value. Agent never sees the vault token.

```
vault_get(path: "shared/gitlab")
→ {"api_url": "https://gitlab.example.com/api/v4", "read_token": "glpat-..."}

vault_get(path: "shared/gitlab", key: "read_token")
→ "glpat-..."
```

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `path` | string | yes | Secret path (e.g. `shared/gitlab`) |
| `key` | string | no | Specific key (omit for all) |

### `vault_list(path)`

List secret paths under a prefix.

```
vault_list(path: "shared/")
→ "gitlab\ndocker"
```

### `vault_status`

Show connection status. Exposes NO secret material.

```
vault_status
→ {"address": "http://vault.localhost", "agent": "reader", "status": "connected"}
```

## Audit Trail

Every vault access is logged:

```
[2026-08-25T20:00:00Z] agent=reader path=shared/gitlab key=read_token status=ok
[2026-08-25T20:00:05Z] agent=reader path=k8s/production status=denied (policy)
[2026-08-25T20:01:00Z] agent=k8s-writer path=k8s/staging key=token status=ok
```

**Logged fields:**
- `timestamp` — ISO 8601
- `agent` — role name from context
- `path` — requested secret path
- `key` — requested key (if any)
- `status` — `ok`, `denied`, `error`

**NOT logged:**
- Secret values
- Vault token
- Request/response bodies

## Configuration

### opencode.jsonc

```jsonc
{
  "plugin": {
    "opencode-zero-trust-agents": {
      "address": "http://vault.localhost",
      "tokenDir": "~/.vault-tokens"
    }
  }
}
```

### Agent markdown (reader.md)

```markdown
---
description: "Read-only agent. K8s read access."
mode: subagent
model: openrouter/nvidia/nemotron-3.5-lightning:free
permission:
  edit: deny
  bash: deny
  read:
    "~/.vault-tokens/*": deny
    "*vault*": deny
---

You are a read-only agent. Use vault_get to access secrets.

Examples:
  vault_get(path="shared/gitlab", key="read_token")
  vault_get(path="k8s/staging")
  vault_list(path="k8s/")
```

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Agent never holds token | Plugin holds in memory, never serializes |
| Token not in tool args | Agent calls `vault_get(path)`, not `vault_get(token, path)` |
| Token not in logs | Plugin never prints token value |
| File permission defense | `chmod 600` on token files |
| Permission deny defense | Agent config denies read/bash on vault paths |
| Vault policy defense | Even if token leaks, scoped to limited paths |
| Audit trail | Every access logged with agent, path, timestamp |
| Ephemeral values | Secret values exist only in agent context for one turn |
| Identity attestation | SPIRE/K8s platform verifies identity (not self-asserted) |
| Short-lived tokens | SPIRE: 1h, K8s: 1h, static: manual rotation |
| Path scoping | Vault policies restrict to specific secret paths |
| Time scoping | Tokens expire, limiting blast radius |
| Audience scoping | JWT `aud` claim restricts token usage |
| Namespace scoping | K8s RBAC limits cluster operations to ai-agents ns |

## File Layout

```
opencode/plugins/opencode-zero-trust-agents/
├── index.js          # Plugin implementation
├── package.json      # Package manifest
└── SPEC.md           # This file

~/.vault-tokens/
├── reader            # chmod 600, scoped to agent-reader policy
├── k8s-readonly      # chmod 600, scoped to agent-k8s-readonly policy
└── gitlab-writer     # chmod 600, scoped to agent-gitlab policy

openbao/
├── docker-compose.yaml   # OpenBao service
├── config.hcl            # Vault config
├── init.sh               # Initialization
├── policies/             # Per-role HCL policies
│   ├── readonly.hcl
│   ├── k8s-readonly.hcl
│   └── gitlab.hcl
└── plugins/
    └── opencode-zero-trust-agents/
        ├── index.js
        ├── package.json
        └── SPEC.md

opencode/agents/
├── reader.md         # Reader agent config
├── k8s-writer.md     # K8s writer agent config
└── gitlab-writer.md  # GitLab writer agent config

openbao/k8s/
└── agent-identity.yaml   # K8s SAs, RBAC, secrets
```

## Implementation Order

1. **Identity resolution** — SPIRE → K8s → static token fallback chain
2. **Token validation** — expiry, audience, path policy checks
3. **Plugin rewrite** — multi-source identity store + audit logging
4. **Permissions** — update agent markdown files with deny rules
5. **Test** — verify: agent can't read token, can call vault_get, audit works
6. **Documentation** — update SPEC.md with final design

## Future Enhancements

| Phase | What | Why |
|-------|------|-----|
| v2 | SPIRE integration | Cryptographic workload identity (SVID) |
| v3 | Token renewal | Auto-renew before expiry |
| v4 | CapSeal pattern | Per-invocation capabilities, not persistent tokens |
| v5 | Audit export | Send audit logs to Langfuse/OTel |
| v6 | Secret redaction | Auto-redact values in tool output |
| v7 | GitLab token broker | Mediate GitLab API calls too |
