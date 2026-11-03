# Agent Hardening

Sandboxes, least-privilege permissions, and credential isolation for OpenCode agents.

## Current State

OpenCode agents (`explore`, `general`, `browser`) run with host-level permissions. The `permission` config in each agent file allows broad `edit` and `bash` access. There is no sandbox boundary between the agent and the host filesystem.

## Threat Model

| Threat | Current Exposure |
|---|---|
| Agent deletes project files | `bash: allow` permits `rm -rf` |
| Agent reads secrets outside repo | No filesystem boundary |
| Agent installs malware | `bash: allow` permits `curl | sh` |
| Agent exfiltrates code to external service | Network access unrestricted |
| Prompt injection hijacks agent | Tool outputs enter conversation unsanitized |

## Sandboxing Options

### 1. `opencode-sandbox` (OS-Level)

**Package:** `opencode-sandbox` (v0.4.0)
**Source:** https://github.com/isanchez31/opencode-sandbox-plugin

Uses `@anthropic-ai/sandbox-runtime` for native OS sandboxing:

| Platform | Mechanism |
|---|---|
| macOS | `sandbox-exec` (Seatbelt profiles) |
| Linux | `bubblewrap` (namespace isolation) |
| Windows | `srt-win` (alpha) |

**What it does:**
- Wraps every `bash` tool invocation with filesystem and network restrictions
- Read-only access to project files (no writes outside worktree)
- Network blocked by default (can whitelist domains)
- Fail-open design: if sandboxing fails, commands run normally (logs warning)

**Linux prerequisites:**

```bash
# Debian/Ubuntu
sudo apt install bubblewrap

# Ubuntu 24.04+ (AppArmor fix)
sudo sysctl -w kernel.unprivileged_userns_clone=1
# Or: echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/99-bubblewrap.conf
```

**Config:**

```jsonc
{
  "plugin": ["opencode-sandbox"]
}
```

### 2. `opencode-sandbox` (Vercel Sandbox)

**Package:** `opencode-sandbox` (v0.4.0, different repo)
**Source:** https://github.com/jacobparis/opencode-sandbox

Runs sessions inside Vercel Sandbox microVMs. Each workspace becomes a persistent sandbox cloned from the repo.

**Features:**
- Fresh microVM with own filesystem and network
- Egress allowlist (curated list of AI provider domains)
- Credential brokering (future: secrets never enter VM)
- Configurable vCPUs, runtime, session timeout

**Config:**

```jsonc
{
  "plugin": [
    ["opencode-sandbox", {
      "vcpus": 2,
      "runtime": "node24",
      "egressPolicy": "default",
      "extraAllowDomains": []
    }]
  ]
}
```

Requires `vercel` CLI and a linked Vercel project. Higher friction for local dev.

### 3. `orca-opencode-plugin` (Behavior-Level Policy)

**Package:** `orca-opencode-plugin` (v1.2.9)
**Source:** https://github.com/christopherkarani/rykan

Not a sandbox — a behavior-level policy layer on top of existing isolation.

**Features:**
- Mediates file access on write paths
- Filters sensitive env vars for agent-launched children
- Detects secret-like access patterns and redacts audit output
- Network decisions for mediated traffic
- Tamper-evident audit logs
- Replayable sessions

**Key distinction:** Docker controls what the process *can* access. Orca controls what the AI agent *is allowed to do*. An agent inside Docker can still delete mounted project files, read secrets, push code, or exfiltrate data over allowed network paths. Orca adds behavior-level policy on top.

## Permission Hardening

### Current Agent Permissions

| Agent | edit | bash | Filesystem | Network |
|---|---|---|---|---|
| explore | deny | deny | Read-only (implicit) | None |
| general | allow | allow | Full | Full |
| browser | deny | deny | None | None (webfetch only) |

### Recommended Hardening

**1. Tighten `general` agent:**

```yaml
---
description: "General-purpose coding agent for repo work, fixes, and implementation tasks."
mode: subagent
model: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free
permission:
  edit:
    "*.md": allow
    "*.json": allow
    "*.jsonc": allow
    "*.ts": allow
    "*.js": allow
    "*.go": allow
    "*.py": allow
    "secrets/**": deny
    ".env*": deny
    "*": ask
  bash:
    "git *": allow
    "make *": allow
    "go *": allow
    "npm *": allow
    "npx *": allow
    "docker compose *": allow
    "rm *": deny
    "curl *": deny
    "wget *": deny
    "ssh *": deny
    "*": ask
---
```

**2. Add global permission rules in `opencode.jsonc`:**

```jsonc
{
  "permission": {
    "external_directory": {
      "~/secrets/**": "deny",
      "~/.ssh/**": "deny",
      "~/.gnupg/**": "deny",
      "~/.aws/**": "deny",
      "~/.config/pass/**": "deny",
      "~/**": "ask",
      "*": "allow"
    },
    "bash": {
      "rm -rf *": "deny",
      "curl * | sh": "deny",
      "curl * | bash": "deny",
      "wget * | sh": "deny",
      "ssh *": "deny",
      "scp *": "deny",
      "sudo *": "deny"
    }
  }
}
```

**3. Restrict `external_directory` per-agent:**

Agents that only need the project directory should not access `~`:

```jsonc
{
  "agent": {
    "explore": {
      "permission": {
        "external_directory": {
          "*": "deny"
        }
      }
    }
  }
}
```

## Credential Isolation

### Principle of Least Privilege

Each agent should only have the credentials it needs:

| Agent | Needs | Should NOT have |
|---|---|---|
| explore | Read-only access to codebase | API tokens, write access |
| general | Read/write to project, git, build tools | Cloud credentials, SSH keys |
| browser | Webfetch only | Filesystem access, shell |

### Implementation

**1. Environment variable filtering:**

Use `orca-opencode-plugin` to filter sensitive env vars per-agent, or manually ensure agents don't inherit unnecessary credentials.

**2. OpenCode's built-in permission system:**

```jsonc
{
  "permission": {
    "edit": "ask",
    "bash": {
      "*": "ask"
    }
  }
}
```

Set global policy to `ask`, then allowlist specific patterns per-agent.

**3. Shell env isolation:**

If agents run via `bash` tool, they inherit the host shell env. To isolate:

- Use a wrapper script that strips sensitive vars before launching agent commands
- Or use `opencode-sandbox` which handles this automatically

## Implementation Priority

| Step | Effort | Impact |
|---|---|---|
| 1. Add global permission deny rules | Low | High — blocks worst-case actions |
| 2. Tighten agent permission files | Low | Medium — reduces blast radius |
| 3. Install `opencode-sandbox` | Medium | High — OS-level isolation |
| 4. Install `orca-opencode-plugin` | Medium | Medium — behavior policy + audit |
| 5. Add credential filtering | High | High — prevents secret leakage |
