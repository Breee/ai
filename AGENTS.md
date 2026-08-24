# AGENTS.md

Local docker-compose stack behind a shared traefik proxy on the external `proxy` network.

## Layout

| Path | What |
|---|---|
| `docker/compose.yaml` | all services: traefik, nginx, langfuse stack, otel-collector |
| `.vscode/settings.json` | Copilot OTel export → Langfuse |
| `.vscode/mcp.json` | Langfuse MCP (self-hosted + docs) |
| `bin/lf-session` | Resolve a Langfuse sessionId → VS Code workspace/transcript |
| `skills/` | Self-optimization skills |
| `opencode/` | Personal opencode config and docs (source of truth; `~/.config/opencode` symlinks here) |

## Conventions

- Start everything with `docker compose -f docker/compose.yaml up -d`.
- Services reach the outside only through traefik labels on `*.localhost`. Do not publish host ports.
- Backing services (db, cache, object store) stay on an internal network; only the web-facing service joins `proxy`.
- This is a local playground. Credentials are hardcoded on purpose — do not parameterize them.
- Never tear down or stop containers after verifying. Leave them running.

## Cost discipline

Copilot traces export to Langfuse. Telemetry from 2026-08-19 showed prompt-cache
*creation* was ~93% of billable-equivalent tokens while being 22% of raw tokens. Two rules
follow from that:

- **Filter tool output at the source.** Anything a tool returns is appended to the prompt
  prefix and re-billed every subsequent call. Prefer `execution_subagent` / `Explore` over
  running verbose commands or reading large files inline. See `skills/context-frugal-tooling`.
- **Keep the prefix stable.** Idle gaps and mid-task tool/model switches invalidate the
  cache and force a rewrite at ~12x the read rate. See `skills/prompt-cache-hygiene`.

For a data-backed retro of a session, use `skills/cost-retro` — it queries Langfuse rather
than guessing. The **Copilot Sessions** dashboard
(`http://langfuse.localhost/project/vscode/dashboards/cmt0hfj3p0005nq07hys11zmc`) has the
same breakdown as charts; `sessionId` there is the Copilot chat session id.

## Trace enrichment

Verified against this deployment, not assumed:

- `deployment.environment.name` set as an OTel **resource** attribute becomes Langfuse's
  first-class `environment` field (filterable, groupable). Launch VS Code with
  `OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=<workspace>"` to get a real
  per-workspace axis. This is the only Langfuse field settable that way.

  Add to `~/.profile` (login shell — picked up by VS Code regardless of how it's launched):
  ```bash
  export OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=localstack"
  ```
  VS Code's OTel exporter reads the variable at startup; changing it requires a window reload.

  The OTel Collector (`docker/compose.yaml`, port 4318) must be running — it receives from VS Code
  and forwards to Langfuse with the auth header. VS Code points at `http://localhost:4318`
  (see `.vscode/settings.json`). The traefik-injected auth on `langfuse.localhost` is no
  longer used for the main OTel path.
- `langfuse.trace.metadata.*` and `langfuse.trace.tags` only map when set as **span**
  attributes. As resource attributes they land in the unfilterable
  `metadata.resourceAttributes.*` catch-all. Adding those needs an OTel Collector in
  between to rewrite resource attrs onto spans.
- There is no `vscode://` deep link to a chat session — the built-in `copilot-chat`
  extension declares no `uriHandler`. Use `bin/lf-session <sessionId>` instead: it maps a
  session id to its workspace folder, transcript and debug log via
  `workspaceStorage/*/chatSessions/<id>.jsonl`, and `--open` opens the folder.
