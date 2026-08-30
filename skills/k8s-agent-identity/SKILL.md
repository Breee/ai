# Skill: k8s-agent-identity

Use this skill when you need to access Kubernetes secrets, generate kubeconfig for
a specific agent role, or verify RBAC enforcement. Each opencode agent maps to a
Kubernetes ServiceAccount with scoped permissions.

## Agent → ServiceAccount mapping

| Agent role | ServiceAccount | K8s access | GitLab access |
|------------|---------------|------------|---------------|
| `reader` | `ai-agents/reader` | Read-only (secrets, configmaps, pods, services) | No |
| `k8s-writer` | `ai-agents/k8s-writer` | Full CRUD (pods, services, deployments, configmaps, secrets) | No |
| `gitlab-writer` | `ai-agents/gitlab-writer` | None | Via PAT secret |

## Prerequisites

- Cluster: `kind-mastery-dev` (context: `kind-mastery-dev`)
- Namespace: `ai-agents`
- Scripts: `openbao/k8s-kubeconfig`, `openbao/gitlab-pat`

## Workflows

### Generate a kubeconfig for an agent

```bash
# Generate kubeconfig (default 1h TTL)
bash openbao/k8s-kubeconfig <role> [duration]

# Examples:
bash openbao/k8s-kubeconfig reader        # read-only, 1 hour
bash openbao/k8s-kubeconfig k8s-writer 30m  # writer, 30 minutes
bash openbao/k8s-kubeconfig reader 8h     # reader, 8 hours

# Output goes to ~/.kube/k8s-<role>.yaml
# Use with: kubectl --kubeconfig=~/.kube/k8s-reader.yaml get pods -n ai-agents
```

### Read a GitLab PAT from K8s

```bash
# Reader PAT (read_api, read_repository scopes)
eval $(bash openbao/gitlab-pat reader)

# Writer PAT (api, write_repository scopes)
eval $(bash openbao/gitlab-pat writer)
```

### Verify RBAC enforcement

```bash
# Reader should succeed
kubectl --kubeconfig=~/.kube/k8s-reader.yaml get secrets -n ai-agents

# Reader should fail on writes
kubectl --kubeconfig=~/.kube/k8s-reader.yaml create configmap test -n ai-agents --from-literal=x=y
# Expected: Error from server (Forbidden)

# k8s-writer should succeed on writes
kubectl --kubeconfig=~/.kube/k8s-k8s-writer.yaml create configmap test -n ai-agents --from-literal=x=y
```

### Regenerate all kubeconfigs

```bash
for role in reader k8s-writer gitlab-writer; do
  bash openbao/k8s-kubeconfig "$role" 1h
done
```

## Security rules

- Never store tokens in files outside `~/.kube/`.
- Never export tokens to environment variables visible to child processes.
- Use short TTLs (≤1h) for interactive sessions.
- Rotate PATs monthly via GitLab UI.
- Do not share kubeconfig files between agents.

## Token lifecycle

1. **Generate**: `k8s-kubeconfig` creates a short-lived SA token.
2. **Use**: kubectl uses the token for API calls.
3. **Expire**: Token automatically expires after TTL.
4. **Regenerate**: Run `k8s-kubeconfig` again with a new TTL.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Error: SA 'X' not found` | Re-apply `openbao/k8s/agent-identity.yaml` |
| `Forbidden` on valid SA | Check rolebinding: `kubectl describe rolebinding <role> -n ai-agents` |
| `token is invalid` | Token expired — regenerate with `k8s-kubeconfig` |
| `gitlab-pat: secret not found` | Secrets not created — re-apply `agent-identity.yaml` |
