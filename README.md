# opencode-agent-trees

An OpenCode V2 server plugin that gives agents a view of their family tree and a durable place to leave work behind:

- `tree_whoami` — identity of the calling session, including its actual parent, root, and depth.
- `tree_family` — parent chain plus the descendants below the root, including siblings/cousins, model pins, and outcomes.
- `tree_journal` — durable, append-only per-session entries in `ctx.storage`.
- `tree_handoff` — records the child's report and prompts its parent with `resume: true`, even when that parent is finished.
- `tree_wake` — a thin `ctx.session.prompt` wrapper for any session.
- Hooks journal child-dispatch results and provider retry failures.

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
| `session.retry` receives provider error `type`, `message`, `status`, and `attempt` | Documented | Retry hook in the V2 server guide |

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

## Known limitations

- Journal entries are JSON values in OpenCode plugin storage, not SQLite session history. There is no compare-and-swap primitive in the documented storage interface; appends from separate server processes are not guaranteed atomic.
- `tree_family` uses a bounded walk (default 200 nodes, maximum 2,000). A large family may be truncated; the response marks that condition.
- Parent links to missing/deleted sessions terminate the upward walk at the missing ID. Corrupt cycles are detected and bounded.
- `tree_handoff` reports `finished` only when the child's recorded outcome is `succeeded`; `failed`, `interrupted`, or absent outcomes are reported as `died`.
- The `tool.execute.after` hook runs after a tool execution. If a process is killed before that hook, it cannot record the result. Provider errors are recorded only when OpenCode emits `session.retry`.
- The child tool name and child-ID payload are implementation details, not a stable public API. Hook matching is intentionally defensive; check logs after OpenCode upgrades.
- Model and agent fields reflect the session metadata OpenCode returns; this plugin does not pin or change child models.
- Live integration is not fully green on the shared OpenCode 2.1.2 service: invoking a `tree_*` tool through Code Mode returned `Tool result declared output without an output schema`. The plugin source was updated to return content only, and the location was reloaded, but the same error remained. Cause is unconfirmed; a fresh service/plugin-process run is needed before treating tool invocation as verified.
- The shared database already contained one historical failed `opencode-go/deepseek-v4.1-flash` child (`Go usage limit exceeded`). It predates this plugin installation, so it did not produce a plugin hook journal entry. A separate free-tier failure was captured by the live `subagent` hook, but its child ID was only embedded in the error text; the current source now extracts IDs from that text, and this adjusted hook behavior has not yet been re-triggered live.

## Development

```sh
npm install
npm test
npm run typecheck
```

Tests cover journal concurrency, identity derivation, sibling-inclusive trees, truncation, cycle defense, handoff formatting, and tool handlers. Live-server behavior must still be rechecked after changing OpenCode versions.
