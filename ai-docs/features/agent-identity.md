# Agent Identity Architecture

Workload identity for AI agents using Kubernetes ServiceAccounts, RBAC, and short-lived tokens.

## Overview

Each opencode agent gets a unique Kubernetes ServiceAccount (SA) with scoped permissions. Agents never share credentials — their identity is their SA token, which expires automatically.

```mermaid
graph TB
    subgraph "opencode"
        A[reader agent] -->|uses| B[reader SA]
        C[k8s-writer agent] -->|uses| D[k8s-writer SA]
        E[gitlab-writer agent] -->|uses| F[gitlab-writer SA]
    end

    subgraph "kind-mastery-dev cluster"
        G[ai-agents namespace]
        B --> G
        D --> G
        F --> G
    end

    subgraph "RBAC"
        H[reader Role<br/>get, list, watch]
        I[writer Role<br/>full CRUD]
        J[gitlab-writer<br/>no K8s access]
    end

    B --> H
    D --> I
    F -.->|denied| J

    H -->|secrets, configmaps, pods, services| K[(K8s API)]
    I -->|pods, services, deployments, configmaps| K
    J -.->|forbidden| K
```

## Agent → ServiceAccount Mapping

| Agent Role | ServiceAccount | K8s Permissions | GitLab Access |
|------------|---------------|-----------------|---------------|
| `reader` | `ai-agents/reader` | Read-only (secrets, configmaps, pods, services) | No |
| `k8s-writer` | `ai-agents/k8s-writer` | Full CRUD (pods, services, deployments, configmaps, secrets) | No |
| `gitlab-writer` | `ai-agents/gitlab-writer` | None | Via PAT secret |

## Token Lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant O as opencode
    participant K as k8s-kubeconfig
    participant A as K8s API
    participant S as Secret Store

    U->>O: "deploy with k8s-writer"
    O->>K: k8s-kubeconfig k8s-writer 1h
    K->>A: create token (k8s-writer SA, 1h TTL)
    A-->>K: short-lived JWT
    K-->>O: ~/.kube/k8s-k8s-writer.yaml
    O->>A: kubectl apply -f deploy.yaml
    A->>A: check RBAC (k8s-writer role)
    A-->>O: deployment created
    Note over A: Token expires after 1h
```

## RBAC Enforcement

```mermaid
flowchart LR
    A[Agent] -->|token| B[K8s API Server]
    B --> C{RBAC check}
    C -->|allowed| D[Resource operation]
    C -->|denied| E[Forbidden error]

    subgraph "reader permissions"
        F[get secrets] --> C
        G[list configmaps] --> C
        H[create deployment] --> E
    end

    subgraph "k8s-writer permissions"
        I[create/delete pods] --> C
        J[update deployments] --> C
        K[create configmaps] --> C
    end

    subgraph "gitlab-writer permissions"
        L[any K8s operation] --> E
    end
```

## Secret Access Pattern

```mermaid
flowchart TD
    A[Agent needs GitLab PAT] --> B[Read K8s secret]
    B --> C{gitlab-pat script}
    C --> D[reader: read-only PAT]
    C --> E[writer: write PAT]
    D --> F[export GITLAB_PAT]
    E --> F
    F --> G[Agent uses PAT for GitLab API]

    H[Agent needs K8s secrets] --> I[kubectl --kubeconfig get secrets]
    I --> J{RBAC check}
    J -->|reader/k8s-writer| K[Access allowed]
    J -->|gitlab-writer| L[Forbidden]
```

## File Layout

```
openbao/
├── k8s/
│   └── agent-identity.yaml    # SAs, RBAC, secrets
├── k8s-kubeconfig              # SA token → kubeconfig
├── gitlab-pat                  # K8s secret → GitLab PAT
├── k8s-secret                  # Generic K8s secret reader
├── agents/
│   ├── reader.md               # Reader agent config
│   ├── k8s-writer.md           # K8s writer agent config
│   └── gitlab-writer.md        # GitLab writer agent config
└── plugins/
    ├── opencode-openbao/       # OpenBao plugin (deprecated)
    └── opencode-k8s-identity/  # K8s identity plugin

opencode/agents/
├── reader.md                   # Reader agent (copied)
├── k8s-writer.md               # K8s writer agent (copied)
└── gitlab-writer.md            # GitLab writer agent (copied)

skills/k8s-agent-identity/
└── SKILL.md                    # How to use agent identities
```

## Usage

### Generate a kubeconfig

```bash
# Reader (read-only, 1 hour)
bash openbao/k8s-kubeconfig reader

# K8s writer (full CRUD, 30 minutes)
bash openbao/k8s-kubeconfig k8s-writer 30m

# Reader (8 hour session)
bash openbao/k8s-kubeconfig reader 8h
```

### Read GitLab PAT

```bash
# Reader PAT
eval $(bash openbao/gitlab-pat reader)

# Writer PAT
eval $(bash openbao/gitlab-pat writer)
```

### Verify RBAC

```bash
# Should succeed
kubectl --kubeconfig ~/.kube/k8s-reader.yaml get secrets -n ai-agents

# Should fail (Forbidden)
kubectl --kubeconfig ~/.kube/k8s-reader.yaml create configmap test -n ai-agents --from-literal=x=y
```

## Security Properties

1. **No shared credentials** — each agent has its own SA
2. **Short-lived tokens** — auto-expire after TTL (default 1h)
3. **Least privilege** — RBAC scoped to exactly what each agent needs
4. **No privilege escalation** — can't modify RBAC, SAs, or ClusterRoles
5. **Audit trail** — every API call logged with SA identity
6. **No gitlab-writer K8s access** — completely isolated

## Rebuild from scratch

```bash
# Delete and recreate
kubectl --kubeconfig ~/.kube/kind-mastery-dev.yaml delete namespace ai-agents
kubectl --kubeconfig ~/.kube/kind-mastery-dev.yaml apply -f openbao/k8s/agent-identity.yaml

# Regenerate all kubeconfigs
for role in reader k8s-writer gitlab-writer; do
  bash openbao/k8s-kubeconfig "$role" 1h
done
```
