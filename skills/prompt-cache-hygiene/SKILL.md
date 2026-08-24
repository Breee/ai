---
name: prompt-cache-hygiene
description: "Use when resuming a session after a break, when a session has run long, when the user asks about prompt caching, cache misses, or why turns suddenly got expensive or slow. Explains how to keep the prompt prefix stable so tokens are billed as cheap cache reads instead of expensive cache writes."
---

# Prompt Cache Hygiene

Prompt caching bills the same tokens at wildly different rates:

- `input_cache_creation` — ~1.25x base. Paid when the prefix is written.
- `input_cached_tokens` — ~0.1x base. Paid when the prefix is reused.

A 167k-token context costs roughly **12x more** to rewrite than to reuse. Everything below
is about avoiding rewrites.

## What invalidates the cache

1. **Idle time.** Caches expire after a few minutes. A long gap forces a full rewrite of the
   entire prefix at 1.25x.
2. **Any change early in the prompt.** The cache matches on a prefix. Editing instructions,
   toggling a tool, or changing the model invalidates everything after the change point.
3. **Context summarization/compaction.** Rewrites the prefix by definition.

## Rules

**Finish a task in one sitting.** The single most expensive call observed on 2026-08-19 was
167,457 cache-creation tokens with zero cache reads — the direct result of a 3.7 hour gap
in a session whose context had grown to ~167k tokens.

**After a long break, start a fresh session rather than resuming a bloated one.** Resuming
pays full price for a context you have mostly finished with. A new session re-reads only
what still matters.

**Front-load stable content, append volatile content.** Instructions and file reads that
will not change belong early. Command output and iteration belong late, so an invalidation
costs less.

**Do not toggle tools, models, or instructions mid-task.** Each switch invalidates the
prefix. Decide the setup before starting.

**Keep the prefix small in the first place.** Cache-read tokens are cheap but not free, and
they are still billed on *every* call. Halving the context halves that recurring floor. See
`context-frugal-tooling`.

## Diagnosing

Pull `usageDetails` per generation from Langfuse (see `cost-retro`):

- `cache_read > 0`, `cache_creation` small → healthy, cache is working
- `cache_creation` large, `cache_read = 0` → cold start or expired cache
- `cache_creation` large **and** `cache_read` large → mid-session invalidation; find what
  changed early in the prompt just before that call
