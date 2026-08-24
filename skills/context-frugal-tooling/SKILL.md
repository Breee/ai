---
name: context-frugal-tooling
description: "Use before fetching web pages, reading large files, running verbose commands, tailing logs, or calling tools that return big blobs. Also use when the user complains about context bloat, token burn, slow turns, or asks to keep the context small. Enforces filtering tool output at the source and delegating noisy work to subagents so raw output never enters the main model's prompt prefix."
---

# Context-Frugal Tooling

Every byte a tool returns is appended to the prompt prefix and re-billed on every
subsequent call in the session. A 30KB tool result is not a one-time cost — it is a
recurring tax for the rest of the session.

## The rule

**Filter at the source, not after the fact.** Deciding to ignore a large result does not
un-bill it. It is already in the context.

## Decision table

| Situation | Do NOT | DO |
|---|---|---|
| Need to know if a command succeeded | `run_in_terminal` with full output | `execution_subagent` — it returns a summary, not the transcript |
| Reading container/build logs | `docker compose logs` | `docker compose logs --tail 40 <svc> \| grep -iE 'error\|warn\|fail'` |
| Reading a config file to check one key | `read_file` whole file | `grep_search` for the key |
| Fetching reference docs | `fetch_webpage` on a full docs page | A search endpoint with a narrow question, or fetch and grep |
| Inspecting a large JSON tool result | Dump it | `python3 -c` to project only the fields you need |
| Exploring an unfamiliar codebase | Chain many `read_file` calls | `runSubagent` with the `Explore` agent — context stays in the subagent |
| Running a DB/API query that may return a lot | Unbounded `SELECT` | Add `LIMIT`, project specific columns, aggregate server-side |

## Subagents are the primary lever

`execution_subagent` and `runSubagent` run their own context. Whatever they read, run, or
print is billed once in their (usually cheaper) session and never enters yours. Only their
final summary crosses back.

Measured on 2026-08-19 in this workspace: six subagent steps on `gemini-3.5-flash` cost
21,557 tokens total. The same work run inline would have permanently added its raw output
to a `claude-opus-5` prefix already at ~167k tokens.

Use a subagent when:
- the command's output size is unpredictable (installs, builds, test runs, log reads)
- you need to retry or iterate to get a command working
- you are searching for something and may need several attempts

Use the tool directly only when you genuinely need the complete, unfiltered output.

## When a large result already landed

Do not re-read or re-quote it. Extract what you need once, in a single message, and move on.
Re-quoting a large blob duplicates it in the prefix.

## Verify before you retry

Repeating a failing call is billed each time. Before a second attempt, confirm the endpoint,
flag, or API actually exists — check `--help`, the schema, or the deployment mode first.
On 2026-08-19 three identical `/api/public/traces` calls all failed because the deployment
runs Langfuse v4 `events_only` mode; one schema check up front would have avoided all three.
