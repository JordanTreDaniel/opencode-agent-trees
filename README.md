# opencode-agent-trees

An OpenCode V2 server plugin that gives agents a view of their family tree and a durable place to leave work behind:

- `tree_whoami` — identity of the calling session, including its actual parent, root, and depth.
- `tree_family` — parent chain plus the descendants below the root, including siblings/cousins, model pins, and outcomes.
- `tree_journal` — durable, append-only per-session entries in `ctx.storage`.
- `tree_handoff` — records a descendant's report and prompts its actual parent with `resume: true`, even when that parent is finished; the child and caller must share a session-family root.
- `tree_wake` — a thin `ctx.session.prompt` wrapper for any session.
- `tree_recover` — recursively resumes a failed session tree leaf-first, with optional NRR-title discovery, sibling barriers, staged separate handoffs, and a structured recovery report.
- Hooks journal child-dispatch results and provider retry-policy decisions, including terminal decisions exposed by the retry hook.

## Install

Requires OpenCode V2. This package targets OpenCode `2.1.2` and pins `@opencode/plugin` to the matching version.

### Package / local directory

Add the package name or local directory to `plugins` in `opencode.json` / `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-agent-trees"]
}
```

For a local checkout, use a path such as `"/absolute/path/opencode-agent-trees"`. OpenCode loads the server export from `package.json`'s `exports["."]` (`./src/index.ts`).

### Project-local plugin

Copy the package under `.opencode/plugins/agent-trees/` and let OpenCode discover it. The directory must contain this package's `package.json` and `src/` tree.

The plugin ID is `agent-trees`; the tool namespace is `tree`.

## Documented vs. inferred behavior

| Claim / behavior | Status | Basis |
|---|---|---|
| `Plugin.define({ id, setup })` is the V2 server entrypoint | Documented | [V2 plugin guide](https://opencode.ai/v2/docs/build/plugins) |
| A package server entrypoint is exported through `package.json` `exports` and can load from `plugins` or `.opencode/plugins/` | Documented | [V2 plugin guide](https://opencode.ai/v2/docs/build/plugins) |
| `ctx.tool.transform`, namespaces, raw JSON Schema inputs, tool `execute(input, context)`, and `ctx.tool.hook("execute.after")` | Documented | [V2 server plugin guide](https://opencode.ai/v2/docs/build/plugins/server) |
| `context.sessionID` identifies the calling tool session | Documented | Tool executor context in the V2 server guide |
| `Session.Info.parentID` plus `ctx.session.list({ parentID })` represent the parent/child relation | Documented | Session `get` / `list` APIs in the V2 server guide |
| `ctx.session.prompt({ sessionID, text, resume })` has no ancestry restriction and can resume a finished, unrelated session | Documented API shape; behavior confirmed by live spike | API docs expose `sessionID` and `resume`; spike below tested a standalone finished root |
| Session listing with `parentID` is enough to reconstruct the tree, including siblings and cousins | Inferred composition | The documented parent field and filtered list API; covered by unit + live tests |
| Built-in child-dispatch tool name is `subagent` | Inferred / runtime-dependent | Current live registry lists `opencode.tool.subagent`; hook matches `subagent`, `task`, and `spawn` to tolerate naming variants |
| The subagent tool's input/result carries a child session ID in a known field | Inferred / runtime-dependent | Hook extracts common ID field names; exact payload depends on OpenCode's built-in tool version |
| `ctx.storage` has atomic compare-and-swap or cross-process transactions | Not documented; not assumed | Journal serializes concurrent appends per key within the plugin process only |
| `session.retry` runs after provider-failure classification and exposes the current retry decision, including a terminal decision that a hook may make retryable | Documented | Retry policy in the V2 server guide |

### Live prompt-into-finished-session spike

The risky behavior was tested before implementation against the shared V2.1.2 server. A new standalone root session was allowed to finish, then received:

```http
POST /api/session/{sessionID}/prompt
Content-Type: application/json

{"text":"Reply with exactly: SPIKE-RESUME-OK. No other words.","resume":true}
```

It returned HTTP 200 with a new user inbox message (`delivery: "steer"`); the session's `updated` time advanced and its `outcome` returned to `succeeded`. Its context included the new user prompt and a subsequent assistant message. This root had no parent, so the call crossed no parent/child ancestry boundary.

## Journal format

Storage key: `journal:<sessionID>`. Values are arrays of entries with `seq`, `at`, `sessionID`, `kind`, and the entry-specific fields. An in-process per-key queue makes simultaneous appends in one plugin process non-losing. `tree_journal` defaults to the calling session but can read/append a named session.

## Recursive recovery

`tree.recover` accepts a session ID from any level, climbs to the true root, then processes the full tree bottom-up: leaves first, results bubbling toward the root. Failed leaves receive the exact F-09 diagnostic first, then the continue prompt. A parent is resumed only after every direct child is already complete or recovered; recovered child summaries are staged as separate `resume: false, delivery: "queue"` messages before the parent's trigger. Already-complete ancestors are not prompted. Recovery stops when the root responds (`rootReactivated`); it does not claim the root's original task is complete.

```ts
// Recover from any session ID in the tree; recovery climbs to the true root.
tree.recover({ rootId: "ses_..." })

// Inspect the full climbed tree plan without sending prompts.
tree.recover({ rootId: "ses_...", dryRun: true })

// Optionally pin resumed sessions to providerID/modelID; otherwise each current model is preserved.
tree.recover({ rootId: "ses_...", pinModel: "provider/model" })

// Leave superseded sub-agent attempts dead while the rest of the tree recovers.
tree.recover({ rootId: "ses_...", excludeSessionIds: ["ses_..."] })
```

`excludeSessionIds` targets only the latest batch inside an orchestrator: excluded sessions classified failed/interrupted/unknown receive zero prompts and no model switch (they never reach `pinModel`), are reported with a `skipped-superseded` action (also counted in `stats.skippedSuperseded`), and count as already-complete so they can never deadlock their parent's sibling barrier. Excluded succeeded sessions already fall through the already-complete path unchanged, and excluded running sessions stay `pending` — a live session is never silently marked complete. IDs are trimmed, empties dropped, and duplicates ignored.

### Optional: NRR marker discovery

When `rootId` is omitted, `tree.recover({})` can discover a session title marked with NRR (or a custom `marker`). Exactly one match proceeds; multiple matches return candidates without prompting. This is an optional convenience, not the primary recovery entry point. Discovery defaults to the case-insensitive `nrr` marker and accepts bare or parenthesized forms such as `NRR foo`, `(NRR) foo`, and `(nrr) Social Media Posting Implementation`. The marker must be followed by punctuation, a space, or end-of-title (`NRRfoo` is not a match). Zero matches do nothing; multiple matches are never batch-resumed.

Credit/auth failures stop the entire run; network failures retry the same prompt up to three total attempts; timeouts are not retried. A partial/max-duration report can be rerun safely because completed sessions are journaled under `recovery:done`.

The result includes ordered `actions`, staged `handoffs`, unresolved `barriers`, per-node model labels, aggregate stats, and `rootReactivated`. Use `dryRun` before the first live recovery when the target tree is uncertain.

## Known limitations

- Journal entries are JSON values in OpenCode plugin storage, not SQLite session history. There is no compare-and-swap primitive in the documented storage interface; appends from separate server processes are not guaranteed atomic.
- `tree_family` uses a bounded walk (default 200 nodes, maximum 2,000). A large family may be truncated; the response marks that condition.
- Parent links to missing/deleted sessions terminate the upward walk at the missing ID. Corrupt cycles are detected and bounded.
- `tree_handoff` reports `finished` only when the child's recorded outcome is `succeeded`; `failed`, `interrupted`, or absent outcomes are reported as `died`. It accepts descendants in the caller's family (not unrelated sessions) and delivers to the child's direct parent.
- The `tool.execute.after` hook runs after a tool execution. If a process is killed before that hook, it cannot record the result. Provider failures are journaled when OpenCode reaches the `session.retry` policy hook; failures outside that provider retry path are not covered by a general terminal-failure hook.
- The child tool name and child-ID payload are implementation details, not a stable public API. Hook matching is intentionally defensive; check logs after OpenCode upgrades.
- Model and agent fields reflect the session metadata OpenCode returns; this plugin does not pin or change child models.
- Initial live integration failed with `Tool result declared output without an output schema`. The V2 runtime's execution branch rejects a returned object that owns `output` when the tool has no output schema; the earlier content-only adapter did not explain why that live path observed `output`. All registered tools declare the V2 object output schema and return structured `output` plus readable `content`. Post-change calls in the already-loaded shared service still returned the same error, and its catalog still advertises the old handoff description; the source fix is not live-verified because the shared service was not restarted or reloaded.
- The shared database already contained one historical failed `opencode-go/deepseek-v4.1-flash` child (`Go usage limit exceeded`). It predates this plugin installation, so it did not produce a plugin hook journal entry. A separate free-tier failure was captured by the live `subagent` hook, but its child ID was only embedded in the error text; the current source now extracts IDs from that text, and this adjusted hook behavior has not yet been re-triggered live.

## Development

```sh
npm install
npm test
npm run typecheck
```

Tests cover journal concurrency, identity derivation, sibling-inclusive trees, recursive recovery and NRR discovery, truncation, cycle defense, handoff formatting, and tool handlers. Live-server behavior must still be rechecked after changing OpenCode versions.
