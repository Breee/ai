# opencode

Personal opencode config and docs. This directory is the source of truth.
`~/.config/opencode` only holds runtime files and symlinks back here.

## Layout

| Path | What |
|---|---|
| `opencode.jsonc` | Config (global via symlink) |
| `tui.jsonc` | TUI settings (global via symlink) |
| `themes/` | Custom themes (global via symlink) |
| `AGENTS.md` | Instructions loaded into every session |
| `docs/` | Personal docs |
| `agents/` | Custom agents |
| `commands/` | Custom commands |
| `skills/` | Skills specific to this store |
| `../skills/` | Shared repo skills (also on `skills.paths`) |

## Conventions

- Edit files here, not under `~/.config/opencode`.
- Prefer new agent/command/skill files over inlining them in `opencode.jsonc`.
- Restart opencode after config, agent, skill, or plugin changes.
- Cheap default: `small_model` and built-in `explore` use `github-copilot/mai-code-1.1-flash`.
- Mastery agents live in the mastery repo under `.opencode/agents/`, not here.
