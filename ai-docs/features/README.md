# AI Features

Operational features for the OpenCode agent stack — monitoring, security, and cost optimization.

## Feature Map

| Feature | Doc | Status | Key Plugin/Tool |
|---|---|---|---|
| **Langfuse Monitoring** | [langfuse-monitoring.md](langfuse-monitoring.md) | Running | `@langfuse/opencode-observability-plugin` |
| **Agent Hardening** | [agent-hardening.md](agent-hardening.md) | Planned | `opencode-sandbox`, `orca-opencode-plugin` |
| **Guardrails & Exfil Detection** | [guardrails-exfil.md](guardrails-exfil.md) | Planned | `opencode-injection-guard`, `@agentguardsco/opencode-plugin` |
| **Cost Optimization** | [cost-optimization.md](cost-optimization.md) | Partial | `opencode-model-router`, `opencode-smart-router` |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode Session                      │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ explore  │  │ general  │  │ browser  │  ← agents    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
│       │              │              │                   │
│  ┌────▼──────────────▼──────────────▼─────┐            │
│  │         Plugin Stack                    │            │
│  │  ┌─────────────┐  ┌─────────────────┐  │            │
│  │  │ injection-  │  │ model-router    │  │            │
│  │  │ guard       │  │ (cost tiers)    │  │            │
│  │  └─────────────┘  └─────────────────┘  │            │
│  │  ┌─────────────┐  ┌─────────────────┐  │            │
│  │  │ sandbox     │  │ langfuse OTEL   │  │            │
│  │  │ (bubblewrap)│  │ exporter        │  │            │
│  │  └─────────────┘  └─────────────────┘  │            │
│  └────────────────────┬───────────────────┘            │
│                       │                                 │
│              OTEL spans + traces                        │
└───────────────────────┼─────────────────────────────────┘
                        │
               ┌────────▼────────┐
               │  OTel Collector │
               │  (port 4318)    │
               └────────┬────────┘
                        │
               ┌────────▼────────┐
               │    Langfuse     │
               │ (langfuse.      │
               │  localhost)     │
               └─────────────────┘
```

## Resource Budget (Local Dev)

| Service | CPU Limit | RAM Estimate | Disk |
|---|---|---|---|
| Langfuse Web | 1.0 | 512MB | — |
| Langfuse Worker | 1.0 | 512MB | — |
| ClickHouse | 3.0 (set) | 1–2GB | 5GB |
| PostgreSQL | — | 256MB | 2GB |
| Redis | — | 128MB | — |
| MinIO | — | 256MB | 5GB |
| OTel Collector | — | 256MB | — |
| **Total** | ~5 cores | ~3–4GB | ~15GB |

This is the existing stack in `docker/compose.yaml`. All services are already running behind traefik on `*.localhost`.

## Implementation Order

1. **Langfuse monitoring** — already running; add OpenCode OTEL plugin
2. **Cost optimization** — add model-router or smart-router plugin
3. **Agent hardening** — add sandbox plugin + tighten permissions
4. **Guardrails** — add injection guard + agentguards
5. **Exfil detection** — custom plugin or orca network policies
