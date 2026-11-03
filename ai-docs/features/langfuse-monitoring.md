# Langfuse Monitoring

Send OpenCode session traces to the self-hosted Langfuse instance for LLM observability.

## Current State

The Langfuse stack is already running at `langfuse.localhost` via `docker/compose.yaml`. It auto-provisions:
- Org: `local`, Project: `vscode`
- Public key: `pk-lf-vscode-local`, Secret key: `sk-lf-vscode-local`
- User: `bree@example.com` / `langfuse`

VS Code Copilot traces already flow via OTel Collector (port 4318). OpenCode traces do not yet flow.

## Integration Options

### Option A: Official Langfuse Plugin (Recommended)

**Package:** `@langfuse/opencode-observability-plugin@latest`
**Source:** https://github.com/langfuse/opencode-observability-plugin

Requires OpenCode's experimental OpenTelemetry support.

**Config additions to `opencode.jsonc`:**

```jsonc
{
  "experimental": {
    "openTelemetry": true
  },
  "plugin": [
    // ... existing plugins ...
    "@langfuse/opencode-observability-plugin@latest"
  ]
}
```

**Environment variables (add to `~/.bashrc`):**

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-vscode-local"
export LANGFUSE_SECRET_KEY="sk-lf-vscode-local"
export LANGFUSE_HOST="http://langfuse.localhost"
```

**What it traces:**
- User turns (every prompt)
- Assistant generations (each model response)
- Tool calls (inputs and outputs)
- Retries
- Reasoning output
- Compaction events
- Failed steps

### Option B: Community Plugin

**Package:** `opencode-plugin-langfuse` (v0.1.8)
**Source:** https://github.com/omercnet/opencode-plugin-langfuse

Same OTEL-based approach, slightly different config:

```jsonc
{
  "experimental": {
    "openTelemetry": true
  },
  "plugin": ["opencode-plugin-langfuse"]
}
```

Uses `LANGFUSE_BASEURL` instead of `LANGFUSE_HOST`.

### Option C: Custom Deep-Trace Plugin

For turn-level tool tracing with human-readable logs, see the approach from `lejubi/LangfuseWithOpencodeDeepTraces`:
- Local `.opencode/plugin/langfuse-deep-trace.ts` listens to OpenCode events
- Emits per-turn spans with child spans per tool call
- Also writes to `/tmp/deep-trace.log` for debugging

This is complementary to Option A — the OTEL plugin handles standards-based export, the deep-trace plugin adds rich tool-level detail.

## Recommended Setup

Use **Option A** (official plugin) as the primary integration. It's maintained by the Langfuse team and uses the standard OTEL pipeline that's already working for VS Code.

```bash
# Add to ~/.bashrc
export LANGFUSE_PUBLIC_KEY="pk-lf-vscode-local"
export LANGFUSE_SECRET_KEY="sk-lf-vscode-local"
export LANGFUSE_HOST="http://langfuse.localhost"
```

```jsonc
// opencode.jsonc additions
{
  "experimental": {
    "openTelemetry": true
  },
  "plugin": [
    "@langfuse/opencode-observability-plugin@latest"
  ]
}
```

## Cost Monitoring Value

Once traces flow, Langfuse provides:
- **Per-model cost tracking** — see which models consume most tokens
- **Per-agent breakdown** — compare explore vs general vs browser costs
- **Session cost attribution** — cost per coding session
- **Prompt cache hit rates** — identify cache-invalidation patterns
- **Latency analysis** — find slow models or tool calls
- **Quality scoring** — annotate traces with manual or LLM-as-judge scores

The existing `skills/cost-retro` skill can query Langfuse for session retrospectives. The **Copilot Sessions** dashboard at `http://langfuse.localhost/project/vscode/dashboards/cmt0hfj3p0005nq07hys11zmc` shows breakdowns.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No traces appearing | Verify `experimental.openTelemetry: true` and plugin in `plugin` array |
| Auth errors | Check `LANGFUSE_HOST` matches `http://langfuse.localhost` (not cloud) |
| Traces arrive but no model info | Some models don't report token counts; check provider |
| ClickHouse queries slow | Normal for first query; subsequent are fast (columnar store) |
