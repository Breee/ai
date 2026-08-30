---
name: model-research
description: "Use when the user asks to update, refresh, or find the best current free/cheap LLM models, or when the /update-models command is invoked. Also use when models are returning errors, hitting rate limits, or when the user asks about model pricing or benchmarks."
---

# Model Research & Update

Research current best free/cheap LLM models and update opencode config.

## When to use

- `/update-models` command invoked
- User asks "what are the best free models right now"
- User asks to refresh model configs
- Models hitting rate limits or errors frequently
- User asks about model pricing/benchmarks

## Research methodology

### Step 1: Discover current models

**Primary source: OpenCode Zen free models** — these are first-class, tested, and zero-cost.

Check `https://opencode.ai/docs/zen/` for the current free model list. Format: `opencode/<model-id>`.

**Secondary source: OpenRouter free models** — wider selection, format: `openrouter/<provider>/<model>:free`.

Use `websearch` to find current best free LLM APIs:

```
websearch: "site:opencode.ai zen free models"
websearch: "openrouter free models list 2026"
websearch: "best free LLM API providers 2026"
```

### Step 2: Verify availability

For each candidate model, verify:
1. **Still free** — check provider docs/pricing pages
2. **Rate limits** — RPM, RPD, TPM, TPD
3. **Context window** — minimum 32K for coding tasks
4. **Tool calling** — required for opencode agents
5. **Data policy** — training on free-tier inputs?

### Step 3: Check benchmarks

Cross-reference with:
- **LMSYS Chatbot Arena** — crowd-sourced ELO ratings
- **LiveCodeBench** — coding-specific benchmarks
- **MMLU-Pro** — general knowledge
- **HumanEval/MBPP** — code generation
- Provider-reported benchmarks (take with grain of salt)

### Step 4: Rank by fit

For each agent role, rank candidates by:

| Role | Priority factors |
|------|-----------------|
| **explore** (fast reads) | Speed > context > cost. Need fast inference, 32K+ context. |
| **general** (coding) | Code quality > tool calling > context. 128K+ preferred. |
| **browser** (UI tasks) | Reliability > speed. Lighter model OK. |
| **small_model** (utility) | Speed > cost. Minimal quality bar. |

### Step 5: Update config

Files to update:

1. **`~/repos/github.com/Breee/ai/opencode/opencode.jsonc`**
   - `model` — main model (prefer OpenCode Zen free models)
   - `small_model` — utility model
   - `agent.*.model` — per-agent primary models
   - `agent.*.fallback_models` — fallback chains

2. **`~/repos/github.com/Breee/ai/opencode/agents/explore.md`**
   - `model:` in frontmatter

3. **`~/repos/github.com/Breee/ai/opencode/agents/general.md`**
   - `model:` in frontmatter

4. **`~/repos/github.com/Breee/ai/opencode/agents/browser.md`**
   - `model:` in frontmatter

5. **`~/repos/github.com/Breee/ai/opencode/opencode-fallback.jsonc`**
   - Global fallback chain

### Step 6: Update documentation

Update `~/repos/github.com/Breee/ai/opencode/AGENTS.md` model table:

```
| `small_model` | <provider>/<model> | <provider>/<model> | Cheap default |
```

### Fallback chain design

Always maintain 3-tier fallback per agent, **avoiding Copilot unless all free options fail**:

```
Primary (Zen free) → Secondary (Zen/OpenRouter free) → Copilot (last resort)
```

Example:
```json
{
  "agent": {
    "general": {
      "model": "opencode/mimo-v2.5-free",
      "fallback_models": [
        "opencode/nemotron-3-ultra-free",
        "opencode/north-mini-code-free"
      ]
    }
  }
}
```

### Validation

After updating, verify:
1. Config syntax is valid JSONC (no trailing commas breaking parsers)
2. All model IDs use `provider/model-id` format
3. Free models use `:free` suffix on OpenRouter
4. Copilot fallbacks use `github-copilot/` prefix
5. No duplicate models across agents (waste of rate limits)

### Output format

Present findings as:

```markdown
## Model Research Report — [date]

### Top Recommendations

| Agent | Current Model | Recommended | Why |
|-------|--------------|-------------|-----|
| explore | openrouter/llama-3.3-70b-versatile:free | [new] | [reason] |
| general | openrouter/nemotron-3-super:free | [new] | [reason] |
| browser | openrouter/laguna-xs:free | [new] | [reason] |

### Changes to apply
- [list of file changes]

### Rate limit budget
- Groq: X RPM, Y RPD
- OpenRouter free: X RPM, Y RPD
- Total daily capacity: ~Z requests

### Risks
- [any concerns about data training, deprecation, etc.]
```

## Key resources

- Models.dev API: `https://models.dev/api/models` — model metadata
- OpenRouter status: `https://openrouter.ai/docs/models`
- OpenRouter limits: `https://openrouter.ai/docs/limits`
- LMSYS Arena: `https://lmarena.ai/leaderboard`
