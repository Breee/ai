# MCP Server Management & Credential Injection

Containerized MCP deployment, credential management, and gateway options.

## Current State

OpenCode config has two MCPs defined locally:
- `mastery` — Python MCP server, runs locally (not containerized)
- `playwright` — npx-based, currently disabled

VS Code has two MCPs via `.vscode/mcp.json`:
- `langfuse` — HTTP MCP at `langfuse.localhost`
- `langfuse-docs` — Remote HTTP MCP at `langfuse.com`

No credential management pattern exists. No gateway or proxy layer.

## Architecture Options

### Option A: Direct Container + OpenCode Config (Simplest)

Run each MCP server as a container in `docker/compose.yaml`, connect via OpenCode's `mcp` config.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MCP Server  │     │  MCP Server  │     │  MCP Server  │
│  (container) │     │  (container) │     │  (container) │
│  github      │     │  langfuse    │     │  postgres    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                    ┌───────▼───────┐
                    │    OpenCode   │
                    │  (mcp config) │
                    └───────────────┘
```

**Pros:** Simple, no extra infra, OpenCode handles it natively.
**Cons:** No shared auth layer, no per-agent tool scoping, no audit trail.

### Option B: agentgateway (MCP-Aware Proxy)

agentgateway is an open-source MCP proxy (Linux Foundation project). It sits between agents and MCP servers, providing routing, auth, and tool-level access control.

```
┌──────────────┐     ┌──────────────┐
│   OpenCode   │     │   VS Code    │
│   (agent)    │     │   (agent)    │
└──────┬───────┘     └──────┬───────┘
       │                    │
       └────────────────────┘
                    │
            ┌───────▼───────┐
            │  agentgateway │
            │  (proxy)      │
            │  - RBAC       │
            │  - audit log  │
            │  - tool scoping│
            └───────┬───────┘
                    │
       ┌────────────┼────────────┐
       │            │            │
┌──────▼───────┐ ┌──▼──────┐ ┌──▼──────────┐
│ github-mcp   │ │ langfuse│ │ postgres-mcp│
│ (container)  │ │ (container)│ │ (container) │
└──────────────┘ └─────────┘ └─────────────┘
```

**Pros:** Centralized auth, per-agent tool scoping, audit trails, transport bridging (STDIO↔HTTP).
**Cons:** Extra binary to run, heavier for local dev, Kubernetes-oriented docs.

### Option C: LiteLLM (LLM + MCP Gateway)

LiteLLM is an AI gateway that handles both LLM model routing AND MCP server management. It provides per-team/project credential routing and MCP permission management.

```
┌──────────────┐
│   OpenCode   │
└──────┬───────┘
       │
┌──────▼───────┐
│   LiteLLM    │
│   Proxy      │
│  - LLM route │
│  - MCP gateway│
│  - cred route│
└──────┬───────┘
       │
  ┌────┼────┐
  │    │    │
```

**Pros:** Unified LLM + MCP gateway, per-team credentials, 100+ provider support.
**Cons:** Supply chain attack in March 2026 (versions 1.82.7-8 compromised), heavy for local dev, overkill if you only need MCP routing.

### Option D: Docker MCP Gateway (Docker's Own)

Docker's official MCP Gateway tool. Runs MCP servers as containers with catalog-based discovery.

```bash
# Install
docker extension install docker/mcp-toolkit

# Add servers
docker mcp server add github
docker mcp server add postgres

# Start gateway
docker mcp gateway start
```

**Pros:** Docker-native, catalog of vetted servers, credential management via Docker secrets.
**Cons:** Docker Desktop required (paid for >250 employees), limited permission control, no per-agent RBAC.

## Recommendation: Option A + Credential Injection

For a local dev setup, **Option A** (direct containers + OpenCode config) is the right starting point. Add agentgateway later if you need multi-agent access control or audit trails.

### Why Not the Others

| Tool | Verdict | Reason |
|---|---|---|
| agentgateway | Overkill for now | Kubernetes-oriented, extra binary, you only have 1 agent (OpenCode) |
| LiteLLM | Supply chain risk | Compromised in March 2026, heavy for MCP-only use |
| Docker MCP Gateway | Paid for commercial | Docker Desktop license, limited RBAC |

## Credential Management Patterns

### Pattern 1: `pass` + Docker Environment (Current)

Use `pass` (the standard Unix password manager) to store secrets, inject into containers via environment variables.

```yaml
# docker/compose.yaml addition
services:
  github-mcp:
    image: ghcr.io/github/github-mcp-server:latest
    environment:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    networks:
      - mcp

  langfuse-mcp:
    image: langfuse/langfuse-mcp:latest
    environment:
      LANGFUSE_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY}
      LANGFUSE_SECRET_KEY: ${LANGFUSE_SECRET_KEY}
      LANGFUSE_HOST: http://langfuse.localhost
    networks:
      - mcp
      - langfuse
```

```bash
# ~/.bashrc — inject from pass
export GITHUB_TOKEN=$(pass show GITHUB_TOKEN 2>/dev/null || true)
export LANGFUSE_PUBLIC_KEY=$(pass show LANGFUSE_PUBLIC_KEY 2>/dev/null || true)
export LANGFUSE_SECRET_KEY=$(pass show LANGFUSE_SECRET_KEY 2>/dev/null || true)
```

**Pros:** Simple, no extra tooling, secrets in pass (encrypted on disk).
**Cons:** Secrets in shell env (visible to all child processes), no rotation, no audit.

### Pattern 2: Docker Secrets (Better Isolation)

Use Docker's built-in secrets mechanism. Secrets are mounted as files, not env vars.

```yaml
services:
  github-mcp:
    image: ghcr.io/github/github-mcp-server:latest
    secrets:
      - github_token
    environment:
      GITHUB_TOKEN_FILE: /run/secrets/github_token
    networks:
      - mcp

secrets:
  github_token:
    file: ./secrets/github_token.txt
```

**Pros:** Secrets not in env, not visible to `ps`, not baked into images.
**Cons:** Secrets as files on disk (still need to manage the source files).

### Pattern 3: Doppler / Infisical (Secrets Manager)

Runtime injection from a centralized secrets manager. Best for production.

```bash
# Doppler
doppler run --project github-mcp -- docker compose up github-mcp

# Infisical
infisical run -- docker compose up github-mcp
```

**Pros:** Centralized, automated rotation, audit trail, per-environment scoping.
**Cons:** External dependency, overkill for local dev.

### Pattern 4: OpenCode's `{env:...}` Interpolation

OpenCode's MCP config supports `{env:VAR}` interpolation. Secrets stay in env vars, never in config files.

```jsonc
{
  "mcp": {
    "github": {
      "type": "local",
      "command": ["docker", "run", "--rm", "-i", "ghcr.io/github/github-mcp-server"],
      "environment": {
        "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
      }
    }
  }
}
```

**Pros:** OpenCode-native, secrets never in config files, simple.
**Cons:** Still requires env vars to be set in shell.

## Recommended Setup

### Step 1: Add MCP Containers to compose.yaml

Add to `docker/compose.yaml`:

```yaml
  # MCP Servers
  github-mcp:
    image: ghcr.io/github/github-mcp-server:latest
    restart: unless-stopped
    environment:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    networks:
      - mcp
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=proxy"
      - "traefik.http.routers.github-mcp.rule=Host(`github-mcp.localhost`)"
      - "traefik.http.routers.github-mcp.entrypoints=web"
      - "traefik.http.services.github-mcp.loadbalancer.server.port=8080"

  langfuse-mcp:
    image: langfuse/langfuse-mcp:latest
    restart: unless-stopped
    environment:
      LANGFUSE_PUBLIC_KEY: ${LANGFUSE_PUBLIC_KEY}
      LANGFUSE_SECRET_KEY: ${LANGFUSE_SECRET_KEY}
      LANGFUSE_HOST: http://langfuse.localhost
    networks:
      - mcp
      - langfuse
```

### Step 2: Store Secrets in pass

```bash
pass insert GITHUB_TOKEN
pass insert LANGFUSE_PUBLIC_KEY
pass insert LANGFUSE_SECRET_KEY
```

### Step 3: Export from pass in ~/.bashrc

```bash
export GITHUB_TOKEN=$(pass show GITHUB_TOKEN 2>/dev/null || true)
export LANGFUSE_PUBLIC_KEY=$(pass show LANGFUSE_PUBLIC_KEY 2>/dev/null || true)
export LANGFUSE_SECRET_KEY=$(pass show LANGFUSE_SECRET_KEY 2>/dev/null || true)
```

### Step 4: Connect from OpenCode

Two options:

**A) Container runs as HTTP MCP (recommended for long-lived servers):**

```jsonc
{
  "mcp": {
    "github": {
      "type": "remote",
      "url": "http://github-mcp.localhost/mcp",
      "headers": {
        "Authorization": "Bearer {env:GITHUB_TOKEN}"
      }
    },
    "langfuse": {
      "type": "remote",
      "url": "http://langfuse.localhost/api/public/mcp",
      "headers": {
        "Authorization": "Basic {env:LANGFUSE_MCP_AUTH}"
      }
    }
  }
}
```

**B) Container runs as stdio MCP (for on-demand servers):**

```jsonc
{
  "mcp": {
    "github": {
      "type": "local",
      "command": ["docker", "run", "--rm", "-i", "--network", "mcp", "ghcr.io/github/github-mcp-server"],
      "environment": {
        "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
      }
    }
  }
}
```

## When to Upgrade to agentgateway

Upgrade when you have:
- Multiple agents (OpenCode + VS Code + others) needing different tool access
- Need for per-agent RBAC (e.g., explore agent can only read, general can write)
- Audit trail requirements (SOC 2, ISO 27001)
- Need for transport bridging (STDIO servers exposed as HTTP)

```yaml
# agentgateway config example
listeners:
  - name: mcp-listener
    protocol: MCP
    sse:
      address: 0.0.0.0:8080
      path: /mcp
    targets:
      - name: github-tools
        protocol: MCP
        stdio:
          cmd: docker
          args: ["run", "--rm", "-i", "ghcr.io/github/github-mcp-server"]
          env:
            GITHUB_TOKEN: "${GITHUB_TOKEN}"
      - name: langfuse-tools
        protocol: MCP
        static:
          host: langfuse-mcp
          port: 8080
          protocol: HTTP
```

## Security Checklist

| Practice | Status | Action |
|---|---|---|
| No secrets in config files | ✅ | Using `{env:...}` interpolation |
| No secrets in Docker images | ⚠️ | Inject at runtime, not build time |
| Per-MCP credential scoping | ⚠️ | Each MCP gets only the creds it needs |
| Credential rotation | ❌ | Add `pass` rotation schedule |
| Audit logging | ❌ | Add agentgateway when needed |
| Network isolation | ✅ | MCP containers on isolated `mcp` network |
| Non-root containers | ⚠️ | Verify each MCP image runs as non-root |

## Unified MCP Config Across All IDEs

### The Problem

Every IDE/client reads MCP config from a different location, uses a different root key, and different env var syntax:

| Client | Config File | Root Key | Env Var Syntax |
|---|---|---|---|
| OpenCode | `opencode.json(c)` | `mcp` | `{env:VAR}` |
| VS Code | `.vscode/mcp.json` | `servers` | `${input:id}` |
| Cursor | `.cursor/mcp.json` | `mcpServers` | `${env:VAR}` |
| Claude Code | `.mcp.json` (workspace root) | `mcpServers` | `${VAR}` |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | `mcpServers` | `${VAR}` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | `${env:VAR}` |
| Codex | `config.toml` | `mcp_servers` | No interpolation |

### Solution: `agentsync` (Rust CLI)

**`agentsync`** (dallay/agentsync) — Rust binary, 32 releases, actively maintained. Syncs MCP configs + instructions + commands + skills across all IDEs using symlinks.

#### Installation

```bash
cargo install agentsync
```

#### Step 1: Create canonical `agentsync.toml`

Place at workspace root (`/home/bree/repos/github.com/Breee/ai/agentsync.toml`):

```toml
[mcp]
enabled = true
merge_strategy = "merge"

[mcp_servers.mastery]
command = "python3"
args = ["tools/mastery-mcp/server.py"]

[mcp_servers.mastery.env]
MASTERY_API = "${MASTERY_API}"
MASTERY_KUBE_CONTEXT = "${MASTERY_KUBE_CONTEXT}"

[mcp_servers.langfuse]
kind = "http"
url = "http://langfuse.localhost/mcp"

[mcp_servers.langfuse.headers]
Authorization = "Bearer ${LANGFUSE_API_KEY}"

[mcp_servers.langfuse-docs]
kind = "http"
url = "https://langfuse.com/mcp"
```

#### Step 2: Sync to all IDEs

```bash
# Dry run — see what would change
agentsync apply --dry-run

# Apply — generates/symlinks config for all detected IDEs
agentsync apply
```

**What agentsync handles automatically:**
- Root key conversion: `mcpServers` (Claude/Cursor) → `servers` (VS Code) → `[mcp_servers.x]` (Codex TOML)
- Env var syntax conversion per client
- Format conversion: TOML → JSON/JSONC/TOML per target
- MCP section merge with existing configs (preserves non-MCP settings)
- Symlink-based (no duplication, one source of truth)

#### Generated Target Files

| Target | File | Format |
|---|---|---|
| OpenCode | `opencode.json(c)` | JSONC |
| VS Code | `.vscode/mcp.json` | JSON (`servers` key) |
| Cursor | `.cursor/mcp.json` | JSON (`mcpServers` key) |
| Claude Code | `.mcp.json` | JSON (`mcpServers` key) |
| Codex | `.codex/config.toml` | TOML (`[mcp_servers.x]` tables) |
| Gemini CLI | `.gemini/settings.json` | JSON |
| Copilot | `.github/copilot-instructions.md` | Markdown |

#### Step 3: Other Agent Config (Instructions, Commands, Skills)

`agentsync` also syncs agent instructions, commands, and skills:

```toml
# agentsync.toml — agent config sections
[instructions.claude]
source = "AGENTS.md"
destination = "CLAUDE.md"

[instructions.cursor]
source = "AGENTS.md"
destination = "AGENTS.md"

[commands.claude]
source = "command"
destination = ".claude/commands"
type = "symlink-contents"
pattern = "*.agent.md"

[skills.opencode]
source = "skills"
destination = ".opencode/skills"
type = "symlink"
```

### Renovate Integration for MCP Versioning

Add to `renovate.json` in the AI repo:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:best-practices"],
  "packageRules": [
    {
      "matchPackagePatterns": ["*mcp*"],
      "automerge": true,
      "automergeType": "branch",
      "labels": ["mcp", "dependencies"]
    }
  ],
  "customManagers": [
    {
      "customType": "regex",
      "fileMatch": ["agentsync\\.toml$"],
      "matchStrings": [
        "args\\s*=\\s*\\[\\s*\"-y\"\\s*,\\s*\"(?<depName>@?[\\w\\d/.-]+)\""
      ],
      "datasourceTemplate": "npm",
      "versioningTemplate": "semver"
    },
    {
      "customType": "regex",
      "fileMatch": ["compose\\.ya?ml$"],
      "matchStrings": [
        "image:\\s*\"(?<depName>mcp[\\w\\d/.:-]+):(?<currentValue>\\d+[\\w\\d.\\-]*)\""
      ],
      "datasourceTemplate": "docker"
    }
  ]
}
```

### Workflow Summary

```
1. Edit MCP config in agentsync.toml (canonical, versioned)

2. Run agentsync to propagate:
   agentsync apply

3. All IDEs update via symlinks:
   - OpenCode: opencode.jsonc
   - Cursor: .cursor/mcp.json
   - VS Code: .vscode/mcp.json
   - Claude Code: .mcp.json
   - Codex: .codex/config.toml
   - Gemini CLI: .gemini/settings.json

4. Renovate monitors for updates:
   - Detects new MCP server versions in agentsync.toml
   - Opens PRs automatically
   - Auto-merges safe updates
```

### Alternative: `mcp-dock` GUI

For a visual approach, use `mcp-dock` (OldJii/mcp-dock):
- GUI manager for 14 AI clients
- One-click install from 8500+ MCP servers
- Config management across all clients
- AppImage available for Linux

```bash
# Download from GitHub releases
# https://github.com/OldJii/mcp-dock/releases
```

## MCP Servers to Consider Adding

| MCP Server | Purpose | Container Image |
|---|---|---|
| `@modelcontextprotocol/server-github` | GitHub API (repos, PRs, issues) | `ghcr.io/github/github-mcp-server` |
| `@modelcontextprotocol/server-filesystem` | Filesystem access | `mcp/filesystem` |
| `@modelcontextprotocol/server-postgres` | PostgreSQL queries | `mcp/postgres` |
| `@modelcontextprotocol/server-fetch` | Web fetching | `mcp/fetch` |
| `@anthropic/mcp-server-slack` | Slack integration | `mcp/slack` |
| `langfuse-mcp` | Langfuse trace queries | `langfuse/langfuse-mcp` |
