---
name: cost-retro
description: "Use when the user asks why a session was expensive, wants a cost/token retro, asks to self-optimize, wants to know what burned the most tokens, or asks how a past session could have been cheaper. Queries the self-hosted Langfuse MCP server for token usage by model, prompt-cache behavior, and per-call breakdowns, then produces concrete, evidence-backed changes to the agent's own workflow."
---

# Cost Retro

Analyze real telemetry from Langfuse and turn it into workflow changes. Never guess at cost — every recommendation must cite a number pulled from Langfuse.

## Prerequisites

The `langfuse` MCP server must be running (`.vscode/mcp.json`). VS Code OTel export must be on (`github.copilot.chat.otel.enabled`).

For a visual version of steps 1-3, open the **Copilot Sessions** dashboard:
`http://langfuse.localhost/project/vscode/dashboards/cmt0hfj3p0005nq07hys11zmc`

Copilot does not send prices, so `totalCost` is always `0`. **Use token counts as the cost proxy**, weighted by billing multipliers:

| Usage type | Relative price | Notes |
|---|---|---|
| `input_cache_creation` | ~1.25x base | Writing a new prompt-cache prefix. The expensive one. |
| `input` | 1.0x base | Fresh, uncached input |
| `input_cached_tokens` | ~0.1x base | Cache hit. Effectively free. |
| `output` / `output_reasoning_tokens` | ~5x base | Small volume, rarely the driver |

Billable-equivalent ≈ `1.25·cacheCreate + 1.0·fresh + 0.1·cacheRead + 5·output`.

## Workflow

### 1. Rank models by volume

`queryMetrics` with `view: observations`, `dimensions: [providedModelName]`,
`metrics: [sum inputTokens, sum outputTokens, count]`, over the session window.

The model with the largest `sum_inputTokens` is the target. Everything else is noise.

To scope to one chat session, add a `sessionId` filter — it holds the Copilot chat session
id. `sessionId` and `userId` are high-cardinality: grouping by them requires both
`config.row_limit` and a `desc` `orderBy` on a measure.

### 2. Split that volume by cache behavior

`queryMetrics` with `dimensions: [providedModelName, usageType]`, `metrics: [sum usageByType]`.

This is the key step. A large `input_cached_tokens` number is *good* — it means the cache worked.
A large `input_cache_creation` number is the actual money.

### 3. Find the individual offenders

`listObservations` with `type: GENERATION` and
`fields: ["id","name","startTime","traceId","providedModelName","usageDetails","latency"]`.

Sort by `usageDetails.input_cache_creation` descending. Investigate the top 3.

### 4. Classify each offender

| Pattern | Diagnosis | Fix |
|---|---|---|
| Large `cache_creation`, `cache_read` = 0 | Cold cache — session start, or idle gap past cache TTL | See `prompt-cache-hygiene` |
| Large `cache_creation` **and** large `cache_read` | Mid-session cache invalidation — the prompt prefix changed | Something was injected early in context; usually a bloated tool result |
| Context grew steadily call over call | Tool output accumulation | See `context-frugal-tooling` |
| Many calls on the expensive model for trivial steps | Bad model routing | Delegate to a subagent on a cheap model |

### 5. Write the retro

For each finding state: the number, the cause, the specific alternative action, and the estimated saving in billable-equivalent tokens. No generic advice.

## Worked example (2026-08-19, this workspace)

| Model | Calls | Input tokens |
|---|---|---|
| claude-opus-5 | 11 | 1,307,189 |
| gemini-3.5-flash | 6 | 21,557 |
| gpt-4o-mini | 9 | 9,313 |

opus-5 split: 332,843 cache-creation, 1,155,321 cache-read, 2,803 output.
Cache-creation was **~93% of the billable-equivalent total** despite being 22% of the raw tokens.

Top three offenders:

| Time | cacheCreate | cacheRead | Diagnosis |
|---|---|---|---|
| 19:20:11 | 167,457 | 0 | 3.7h idle gap expired the cache; the whole 167k context was rewritten at 1.25x |
| 15:39:18 | 80,901 | 14,311 | Cold session start against an already-large context |
| 15:40:34 | 67,281 | 97,455 | Mid-session invalidation right after a 30KB tool result landed in context |

Root cause of all three: the context had been inflated to ~167k tokens by a handful of
unfiltered tool results (full docs pages, a raw `docker-compose.yml`, 432 lines of Prisma
migration logs). Every later call paid for that prefix, twice — once to write it, then
again on every rewrite.

Counter-example from the same session: six `execute_tool` steps were delegated to a
subagent on gemini-3.5-flash and cost 21,557 tokens *total*. The equivalent work done
inline on opus-5 would have added its raw output to the prefix permanently.
