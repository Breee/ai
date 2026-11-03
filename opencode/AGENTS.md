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
| `docs/voice-setup.md` | TTS/STT setup guide (Piper + Ollama) |
| `agents/` | Custom agents |
| `commands/` | Custom commands |
| `skills/` | Skills specific to this store (model-research, etc.) |
| `../skills/` | Shared repo skills (also on `skills.paths`) |

## Conventions

- Edit files here, not under `~/.config/opencode`.
- Prefer new agent/command/skill files over inlining them in `opencode.jsonc`.
- Restart opencode after config, agent, skill, or plugin changes.
- Mastery agents live in the mastery repo under `.opencode/agents/`, not here.

## Model Setup

Free model stack using OpenCode Zen. Copilot only as last resort. Updated via `/update-models`.

| Agent | Model | Fallback Chain |
|-------|-------|---------------|
| `small_model` | `opencode/nemotron-3.5-lightning-free` | — |
| `model` (main) | `opencode/mimo-v2.5-free` | — |
| `explore` | `opencode/nemotron-3.5-lightning-free` | North Mini Code → OpenRouter North Mini |
| `general` | `opencode/mimo-v2.5-free` | Nemotron 3 Ultra → North Mini Code |
| `browser` | `opencode/nemotron-3.5-lightning-free` | North Mini Code → OpenRouter North Mini |

### Keeping models current

- **Manual**: Run `/update-models` to research and apply latest free models
- **Advisory**: Load the `model-research` skill for benchmark comparison without auto-apply

### Provider API keys

| Provider | Env var | Source |
|----------|---------|--------|
| OpenRouter | `OPENROUTER_API_KEY` | `pass show OPENROUTER_API_KEY` |
| GitHub Copilot | built-in | `gh auth token` |

## Plugins

| Plugin | Purpose |
|--------|---------|
| `@tarquinen/opencode-dcp` | DCP integration |
| `opencode-runtime-fallback` | Per-agent fallback chains on 429/5xx errors |
| `@renjfk/opencode-voice` | TTS/STT with Piper + Ollama |

## Token Budget (Hard Rules)

- Default to ultra-brief responses: max 5 lines unless detail is asked for.
- Start with the answer, no preamble, no recap.
- Never restate the user's request, context, or unchanged plan items.
- Intermediary updates: max 1 short sentence, only on meaningful state change.
- If nothing changed, send no progress update.
- Use bullets only when needed; max 5 bullets.
- No examples, alternatives, or background unless explicitly requested.
- No code blocks unless explicitly asked for code.
- For edits, report only: (1) files changed, (2) one-line reason per file, (3) verification result.
- For command output, summarize only decisive lines (max 3).
- Ask at most one clarifying question, and only if blocked.
- Prefer smallest possible patch; avoid stylistic rewrites.
- Do not repeat prior guidance from earlier turns.
- If the target resource or namespace is unclear, do not run cluster-wide queries. Ask first.

## Working Rules

### 0. No Workarounds

If you need a tool that is not installed, ask the user to install it. Do not write workarounds, alternative implementations, or fake solutions. State what is missing and what command to run.

### 1. Think Before Coding

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them.
- If a simpler approach exists, say so. Push back when warranted.
- Read documentation for tools/libraries before using them. Don't guess.

### 2. Simplicity First

- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked. No abstractions for single-use code.
- If 200 lines could be 50, rewrite it.

### 3. Surgical Changes

- Touch only what you must. Match existing style.
- Remove only imports/variables/functions your changes made unused.
- Every changed line should trace to the user's request.

### 4. Goal-Driven Execution

- Define success criteria before starting. Loop until verified.
- For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```
- Don't stop after one feature. Continue the backlog until done or blocked.

### 5. After Every Step

1. Commit — short subject line, body only if truly needed.
2. Update docs if the change affects project documentation.

### 6. After Every Feature

- Code review: check for dead code, TODOs, missing error handling, security shortcuts.
- Verify in running system: confirm behavior, empty/loading/error states.
- Feature is not done until review + verification pass.
