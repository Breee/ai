# Cost Optimization & Self-Optimization

Route tasks to the cheapest adequate model, track costs, and learn from usage patterns.

## Current State

The current setup uses free OpenRouter models for subagents and GitHub Copilot as fallback. There is no task-based routing — every `general` task goes to Nemotron Ultra regardless of complexity, and every `explore` task goes to Nemotron Lightning.

The `opencode-free-fleet` plugin already races free models for the best response, but doesn't do task-complexity-based routing.

## Cost Optimization Plugins

### 1. `opencode-model-router` (Recommended)

**Package:** `opencode-model-router` (v1.10.0)
**Source:** https://github.com/marco-jardim/opencode-model-router

**Core idea:** Use a mid-tier model as orchestrator. It reads a routing protocol on every message and delegates to `@fast`, `@medium`, or `@heavy` tiers based on task complexity.

**How it works:**
1. Injects a ~3,084-char routing protocol into the system prompt
2. Orchestrator reads task, classifies by complexity, delegates to appropriate tier
3. Cost ratios injected: `@fast=1x`, `@medium=5x`, `@heavy=20x`
4. Orchestrator sees price before deciding — picks cheapest tier that can handle the task

**Budget modes:**
- `/budget normal` — balanced (default)
- `/budget budget` — aggressive savings, defaults everything to `@fast`
- `/budget quality` — liberal use of stronger models
- `/budget deep` — heavy-first for long architecture/debug runs

**Cost savings (claimed):**

| Setup | Session Cost | vs all-Opus |
|---|---|---|
| All-Opus (no router) | 600x | baseline |
| Sonnet orchestrator + router (normal) | 100x | **-83%** |
| Sonnet orchestrator + router (budget) | 50x | **-92%** |

**Presets:** `anthropic`, `openai`, `github-copilot`, `google`, `hybrid`

**Config:**

```jsonc
{
  "plugin": [
    ["opencode-model-router", {
      "preset": "hybrid",
      "mode": "normal"
    }]
  ]
}
```

**For our free-model stack:** The `@fast` tier would use free OpenRouter models (Nemotron Lightning, Laguna), `@medium` would use mid-tier free models (Nemotron Ultra), and `@heavy` would use Copilot grok or paid fallback.

### 2. `opencode-smart-router`

**Package:** `opencode-smart-router`
**Source:** https://github.com/RageLtd/opencode-smart-router

Similar concept to model-router but with:
- SQLite persistence for session/cost analytics
- Real-time budget monitoring
- Pattern analysis and adaptive routing
- Conservative/balanced/aggressive strategies

**Config:**

```jsonc
{
  "plugin": [
    ["opencode-smart-router", {
      "analytics": true,
      "routingStrategy": "balanced",
      "costThresholds": {
        "criticalMax": 100,
        "complexMax": 50,
        "experimentalMax": 20
      }
    }]
  ]
}
```

### 3. `@ramtinj95/opencode-tokenscope`

**Package:** `@ramtinj95/opencode-tokenscope` (v1.8.1)

Token usage analysis and cost tracking. Lighter-weight than full routers — focuses on visibility rather than routing.

### 4. Existing Plugins (Already Installed)

**`opencode-free-fleet`** — already configured. Races free models, accepts first response. Good for latency optimization but doesn't do task-complexity routing.

**`opencode-runtime-fallback`** — already configured. Handles 429/5xx with cooldown and auto-recovery. Safety net, not a router.

**`opencode-task-router`** — already configured. Uses local Ollama `qwen3:8b` to classify tasks as free/cheap/moderate/expensive. Recommends agent + model tier. Learns from past routing decisions.

## Self-Optimization Capabilities

### What "Self-Optimization" Means

The system should:
1. **Track** which models perform best for which task types
2. **Learn** from cost/performance data over time
3. **Adapt** routing decisions based on actual outcomes
4. **Report** on cost savings and quality tradeoffs

### Implementation Layers

#### Layer 1: Langfuse Trace Analysis (Already Available)

Once OpenCode traces flow to Langfuse:
- Query per-model cost breakdowns
- Identify models with high latency but low quality
- Track token usage per agent per session
- Use `skills/cost-retro` for session-level retrospectives

#### Layer 2: Task Router Learning (Already Configured)

`opencode-task-router` maintains `.opencode/router-history.jsonl`:
- Records task → tier → model → outcome
- Uses history as few-shot examples for the classifier
- Improves routing accuracy over time

#### Layer 3: Smart Router Analytics (New)

If `opencode-smart-router` is added:
- SQLite database tracks sessions, costs, analytics
- Pattern analysis identifies recurring task types
- Adaptive routing adjusts based on cumulative data
- Budget enforcement prevents overspend

#### Layer 4: Custom Optimization Plugin (Advanced)

Build a plugin that:
1. Hooks `session.completed` to log final cost/quality metrics
2. Queries Langfuse for historical data
3. Adjusts `agent.*.model` config based on performance trends
4. Rotates models when a provider's free tier degrades

```typescript
// .opencode/plugin/cost-optimizer.ts
import type { Plugin } from "@opencode-ai/plugin"

export default (async ({ client }) => ({
  "session.completed": async (input) => {
    // Log session metrics
    // Query Langfuse for cost breakdown
    // If primary model hit rate limits > 3x today, suggest rotation
    // Update routing preferences in router-history.jsonl
  },
})) satisfies Plugin
```

## Recommended Stack

| Component | Plugin | Purpose |
|---|---|---|
| **Task classification** | `opencode-task-router` (installed) | Classify task complexity via local LLM |
| **Model racing** | `opencode-free-fleet` (installed) | Race free models for fastest response |
| **Tier routing** | `opencode-model-router` (new) | Delegate to fast/medium/heavy tiers |
| **Runtime fallback** | `opencode-runtime-fallback` (installed) | Handle 429/5xx with cooldown |
| **Cost visibility** | Langfuse + `opencode-tokenscope` | Track and analyze costs |
| **Learning** | `opencode-task-router` history | Improve routing over time |

## Integration with Existing Free Model Stack

The current model assignments:

| Agent | Primary Model | Role |
|---|---|---|
| explore | `openrouter/nvidia/nemotron-3.5-lightning:free` | Fast reads (1M context) |
| general | `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | Heavy coding (550B params) |
| browser | `openrouter/poolside/laguna-s-2.1:free` | UI tasks (262K context) |

With `opencode-model-router`, the routing would become:
- **@fast** tier → Nemotron Lightning or Laguna (free, fast)
- **@medium** tier → Nemotron Ultra (free, high quality)
- **@heavy** tier → Copilot grok (paid, fallback)

The router's orchestrator (running on a mid-tier model) decides per-message which tier to use, rather than hardcoding per-agent.

## Cost Tracking Dashboard

Once Langfuse + cost optimization are active, monitor:

| Metric | Where | Why |
|---|---|---|
| Cost per session | Langfuse dashboard | Identify expensive sessions |
| Cost per model | Langfuse traces | Compare free vs paid model costs |
| Cache hit rate | Langfuse + skills/cost-retro | Prompt cache invalidation issues |
| Rate limit hits | `opencode-runtime-fallback` logs | Provider quota exhaustion |
| Routing decisions | `.opencode/router-history.jsonl` | Verify task→tier classification |
| Quality scores | Langfuse manual annotations | Ensure cost savings don't hurt quality |

## Implementation Priority

| Step | Effort | Impact |
|---|---|---|
| 1. Add OpenCode OTEL plugin to Langfuse | Low | High — visibility into costs |
| 2. Add `opencode-model-router` | Medium | High — 83-92% cost reduction |
| 3. Configure tier mapping for free models | Low | Medium — aligns with existing stack |
| 4. Add `opencode-tokenscope` | Low | Medium — token usage analytics |
| 5. Build custom cost-optimizer plugin | High | Medium — adaptive routing |
| 6. Set up Langfuse cost dashboards | Medium | Medium — ongoing monitoring |
