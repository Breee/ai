# opencode-sandbox-agent

Containerized agent with SPIRE identity + nono sandbox + gVisor runtime.

## Prerequisites

- Docker with gVisor runtime (`runsc`) installed
- Docker Compose v2

## Quick Start

1. **Load the sandbox config** (overrides default config):

   ```bash
   opencode --config opencode.sandbox.jsonc
   ```

   Or symlink it:
   ```bash
   ln -sf opencode.sandbox.jsonc ~/.config/opencode/opencode.jsonc
   ```

2. **Use the tools**:

   ```
   sandbox_spawn(agent_id: "reader", workspace: "/path/to/repo")
   sandbox_status()
   sandbox_kill(agent_id: "reader")
   sandbox_list()
   ```

## Architecture

```
Host
├── opencode (main process)
│   └── opencode-sandbox-agent plugin
│       └── spawns container ↓
│
├── Agent Container (gVisor runtime)
│   ├── SPIRE agent (identity)
│   ├── nono (filesystem + network sandbox)
│   └── opencode (agent framework)
│       └── workspace mounted r/w
│
└── SPIRE Server (identity CA)
    └── issues SVIDs to agents
```

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Kernel isolation | gVisor (user-space kernel) |
| Filesystem isolation | nono deny-by-default + read-only root |
| Network isolation | nono host allowlist |
| Credential protection | nono proxy injection (key never enters sandbox) |
| Identity attestation | SPIRE SVID (short-lived, auto-rotating) |
| Resource limits | Docker cgroups (CPU, RAM, PIDs) |
| Privilege drop | cap-drop=ALL, no-new-privileges |

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Agent container image |
| `agent-entrypoint.sh` | Wires SPIRE + nono + opencode |
| `docker-compose.spire.yaml` | SPIRE server |
| `docker-compose.agent.yaml` | Agent container template |
| `spire-server.conf` | SPIRE server config |
| `index.js` | OpenCode plugin |
| `package.json` | Plugin manifest |
