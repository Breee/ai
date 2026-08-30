# OpenBao + OpenCode: Agent Identity & Secrets

Slim secrets management for OpenCode agents. Each agent gets an identity (AppRole)
and scoped access to secrets via OpenBao.

## Architecture

```
Agent spawned
  → plugin reads agent config (vault.role, vault.secrets)
  → authenticates to OpenBao via AppRole (role_id + secret_id)
  → OpenBao validates, returns scoped token
  → agent fetches secrets via vault-read command
  → token auto-renews, revoked on agent exit
```

## Quick Start

### 1. Start OpenBao

```bash
cd openbao
docker compose up -d
```

### 2. Initialize (first time only)

```bash
docker compose exec openbao sh /openbao/init.sh
```

This creates:
- KV v2 secrets engine at `secret/`
- Policies: `agent-explore`, `agent-general`, `agent-deploy-agent`, `agent-ops-agent`
- AppRole auth with roles for each agent
- Example secrets seeded

Save the ROLE_ID and SECRET_ID output — you'll need them in step 3.

### 3. Configure opencode.jsonc

Add to your plugin list:

```jsonc
{
  "plugin": [
    ["opencode-openbao", {
      "address": "http://127.0.0.1:8200",
      "agent": "general",
      "roleId": "<ROLE_ID from init.sh>",
      "secretId": "<SECRET_ID from init.sh>"
    }]
  ]
}
```

### 4. Add vault-read to PATH

```bash
chmod +x openbao/vault-read
export PATH="$HOME/repos/github.com/Breee/ai/openbao:$PATH"
```

### 5. Restart opencode

The plugin auto-authenticates on startup. Run `/vault-status` to verify.

## Commands

| Command | Description |
|---|---|
| `/vault-read <path>` | Dump all keys at a secret path |
| `/vault-read <path> <key>` | Read a single key |
| `/vault-status` | Show token info and TTL |
| `/vault-login` | Force re-authentication |

CLI equivalent (for bash scripts):

```bash
vault-read deploy/argocd           # all keys
vault-read deploy/argocd api_key   # single key
vault-read export deploy/argocd    # as export lines
eval $(vault-read export deploy/argocd api_key)  # inject into env
```

## Secret Paths

| Path | Agent | Contents |
|---|---|---|
| `secret/shared/gitlab` | general, deploy | GitLab API token |
| `secret/shared/docker` | general, deploy | Docker registry creds |
| `secret/general/config` | general | Agent-specific |
| `secret/deploy/argocd` | deploy-agent | ArgoCD server + key |
| `secret/deploy/kargo` | deploy-agent | Kargo server + token |
| `secret/deploy/k8s-staging` | deploy-agent | Staging kubeconfig |
| `secret/ops/aws-sts` | ops-agent | AWS STS role ARN |
| `secret/ops/grafana` | ops-agent | Grafana API key |

## Security Model

- **Identity**: Each agent authenticates with a unique AppRole (role_id + secret_id)
- **Scoping**: Policies restrict each agent to its allowed secret paths
- **Ephemeral**: Tokens expire (1h default), auto-renew during session, revoked on exit
- **Audit**: OpenBao logs every secret access with agent identity
- **No secrets in config**: Credentials are fetched at runtime, not stored in agent files

## Production Hardening

For real use beyond PoC:

1. **Enable TLS** on OpenBao listener
2. **Use a real backend** (PostgreSQL/Consul) instead of SQLite
3. **Rotate AppRole secret_ids** periodically
4. **Set up OpenBao audit logging** to a file or syslog
5. **Network isolation**: OpenBao on its own Docker network, only plugin can reach it
6. **Consider OIDC** instead of AppRole for K8s-native identity (see K3s migration path)

## Files

```
openbao/
├── docker-compose.yaml              # OpenBao service (128MB limit)
├── config.hcl                       # OpenBao config
├── init.sh                          # One-time initialization
├── policies/
│   ├── explore.hcl                  # Read-only, no secrets
│   ├── general.hcl                  # Developer secrets
│   ├── deploy-agent.hcl             # Deploy secrets
│   └── ops-agent.hcl                # Operator secrets
├── vault-read                       # CLI helper
├── plugins/opencode-openbao/
│   ├── package.json
│   └── index.js                     # OpenCode plugin
└── agents/
    ├── general-with-vault.md        # Example agent config
    └── deploy-agent-with-vault.md   # Example agent config
```
