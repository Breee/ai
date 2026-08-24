# AI local dev stack

This repo keeps the local developer environment in one place:

- Docker Compose stack for the Langfuse + OpenTelemetry local observability setup
- Helper scripts and VS Code settings for the stack
- Portable opencode config and skills, symlinked into `~/.config/opencode`

## Layout

| Path | Purpose |
|---|---|
| `docker/compose.yaml` | Main local compose stack: Traefik, Langfuse, ClickHouse, Redis, Postgres, MinIO, OTel collector |
| `.vscode/` | VS Code OTel exporter settings |
| `bin/` | Helper scripts such as session lookup |
| `skills/` | Shared local tooling and cost/telemetry skills |
| `opencode/` | Source-of-truth opencode config, docs, agents, commands, and skills |

## Quick start

```bash
make install
```

This does two things in one place:

1. installs the opencode runtime symlinks under `~/.config/opencode`
2. starts the docker stack behind the shared `proxy` network

You can also manage the pieces directly:

```bash
make opencode-install
make opencode-uninstall
make up
make down
make status
```

The repo root is the single place for all setup, so there is no separate nested opencode makefile to maintain.

## Notes

- The compose stack expects the external Docker network named `proxy` to exist.
- The repo is designed to live at `~/repos/github.com/Breee/ai`.
- Edit files in the repo; runtime files under `~/.config/opencode` are symlinks or generated cache state, not the source of truth.
