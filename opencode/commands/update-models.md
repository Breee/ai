---
description: "Research and update LLM model configs to current best free/cheap options"
agent: build
---

Load the `model-research` skill and perform a full model research cycle:

1. Use websearch to find current best free LLM providers and models (check Groq, OpenRouter free tier, Cerebras, Google AI Studio, NVIDIA NIM)
2. Verify each candidate is still free, check rate limits (RPM/RPD), context window, and tool calling support
3. Cross-reference with LMSYS Arena and LiveCodeBench benchmarks
4. Read the current config at `~/repos/github.com/Breee/ai/opencode/opencode.jsonc`
5. Read current agent files at `~/repos/github.com/Breee/ai/opencode/agents/{explore,general,browser}.md`
6. Recommend changes with reasoning
7. Apply the updates to all config files
8. Update `~/repos/github.com/Breee/ai/opencode/AGENTS.md` model table
9. Print a summary of all changes made

If `$ARGUMENTS` contains "dry-run", only show recommendations without applying changes.
If `$ARGUMENTS` contains "quick", only check Groq and OpenRouter (skip other providers).
