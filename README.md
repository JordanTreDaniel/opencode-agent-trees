# opencode-agent-trees

An OpenCode V2 server plugin that gives agents a view of their family tree and a durable place to leave work behind:

- `tree_whoami` — identity of the calling session, including its actual parent, root, and depth.
- `tree_family` — parent chain plus the descendants below the root, including siblings/cousins, model pins, and outcomes.
- `tree_journal` — durable, append-only per-session entries in `ctx.storage`.
- `tree_handoff` — records a descendant's report and prompts its actual parent with `resume: true`, even when that parent is finished; the child and caller must share a session-family root.
- `tree_wake` — a thin `ctx.session.prompt` wrapper for any session.
- `tree_recover` — recursively resumes a failed session tree leaf-first, with optional NRR-title discovery, sibling barriers, staged separate handoffs, and a structured recovery report.
- `tree_status` — filtered projection over six named views (running, paused, restart candidates, one tree, one subtree), merging the session database with the host's live running set and pending forms.
- Hooks journal child-dispatch results and provider retry-policy decisions, including terminal decisions exposed by the retry hook.

## Install

Requires OpenCode V2. This package targets OpenCode `2.1.2` and pins `@opencode/plugin` to the matching version.

Node.js 22 or newer — the optional `scripts/tree-view.mjs` uses the built-in `node:sqlite` module, and the test suite runs TypeScript through `tsx`.

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
| `session_v2` carries `parent_id`, `idle_outcome`, `time_idle`, `time_archived`, `time_suspended` and `fork_session_id`, with an index on `parent_id` | Observed schema | The live OpenCode session database; `time_suspended` is written by `SessionStore.claim` (`packages/core/src/session/store.ts`) |
| The host's `/api/session/active` and `/api/sessions/status` are the live running-set and pending-form source | Observed host API, not a documented OpenCode API | Probed live 2026-11-11: `{data:{sid:{type:"running"}}}` and `{sessions, pending, serverTime}`. Both require host auth — HTTP 401 without a session cookie. |
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

## View scripts

Three optional, read-only helper scripts render the same tree outside the plugin. All are plain ESM and require Node 22+; none is part of the published package (`package.json` `files` is `src` only) — they exist for local inspection.

```sh
# Print the family tree from a live OpenCode session database.
node scripts/tree-view.mjs --root ses_... [--mode restart|json] [--depth N] [--db PATH]

# Render the sidebar/dashboard view for a running instance.
node scripts/sidebar-view.mjs [--json] [--cli PATH] [--db PATH] [--port PORT] [--out FILE]

# Print one view of the status projection (see Views below).
node scripts/tree-status.mjs [--view <name>] [--json] [--all] [--db PATH] [--host URL|off]
```

- `tree-view.mjs` reads the session DB. Point it at yours with `--db` or `OPENCODE_DB`; the default is `$XDG_DATA_HOME/opencode/opencode.db`, falling back to `$HOME/.local/share/opencode/opencode.db`. Those are different instances — pass `--db` when in doubt.
- `tree-status.mjs` resolves its database the same way and merges the host's live state; see [Views](#views).
- `sidebar-view.mjs` shells out to an OpenChamber CLI. Configure it with `--cli` / `OPENCHAMBER_CLI` and `--db` / `OPENCODE_DB`.
- `--pin-model` on `tree-view.mjs` defaults to `opencode-go/deepseek-v4.1-flash`; pass your own with `--pin-model provider/model`.

## Views

`tree.status` (and `scripts/tree-status.mjs`) answers "what is running, what is paused on a question, what is restartable" from one projection. The view names and the filter vocabulary are declared once in [`src/lib/views.json`](./src/lib/views.json); the engine, the CLI and this section all read that file, so a view cannot drift from its definition.

```sh
node scripts/tree-status.mjs [--view <name>] [--root <id>] [--subtree <id>] \
  [--json] [--limit N] [--all] [--db PATH] [--host URL | --host off]
```

### The six views

| View | Filters | What it answers |
|---|---|---|
| `default` | `isRoot ∧ ¬fork ∧ ¬scheduled` | Conversations you started. **This is a proxy** — see below. |
| `running` | `status = running` | Sessions with a turn in flight or holding the execution claim. |
| `needs-restart` | `¬archived ∧ (outcome ∈ {failed, interrupted} ∨ orphaned)` | Restart candidates: recorded failures **plus orphaned claims** — rows that hold an execution claim but are absent from the host's active set. A session with no recorded outcome is never listed through the outcome arm; the orphan arm needs the host (see [Degradation](#data-sources-and-honesty-rules)). |
| `question-paused` | `status = running ∧ hasPendingForm` | Sessions genuinely waiting on a question. |
| `tree:<rootId>` | `rootId = <id>` | Every session in one tree, including the root (also `--root <id>`). |
| `subtree:<id>` | `isSubtreeOf <id>` | One session and everything beneath it, self-inclusive (also `--subtree <id>`). |

`default` is a **documented proxy, not a field**. Upstream exposes no user-spawned flag, so `isRoot ∧ ¬fork ∧ metadata.openchamber.kind ≠ 'scheduled'` is the closest available approximation of "a conversation the user started". A session with no metadata counts as not scheduled, which widens the view instead of hiding rows; a scheduled session that was never labelled is indistinguishable from a user one.

`question-paused` requires **both** halves on purpose. A paused session still reports `busy` and holds the execution claim, so status alone cannot find it; and a form can outlive its turn, so a pending form alone is not proof of a pause. A pending form with no running turn is a stale form and does not qualify.

`needs-restart` is a disjunction on purpose (`$any` in [`views.json`](./src/lib/views.json)): the outcome arm (`outcome ∈ {failed, interrupted}`) finds recorded failures from the database alone, and the orphan arm (`orphaned = true`) finds execution claims the host no longer lists — the case core never auto-resumes, which a status filter alone would miss because the host can still report such a row as running. An unclaimed session is knowably not orphaned from the database alone; a **claimed** session without the host is `orphaned: null` (unknown), so the projection sets `meta.stale: true` and warns that orphan detection is unavailable instead of silently listing zero.

### Filter vocabulary

| Filter | Type | Derived from |
|---|---|---|
| `isRoot` / `hasParent` | boolean | `parent_id` present or absent |
| `parentId` | string | `session_v2.parent_id` |
| `rootId` | string | walking `parent_id` to the top of the chain |
| `depth` | integer or `{min,max}` | number of parent hops to the root (a root is `0`) |
| `inTree` | boolean | has a parent or at least one child |
| `isSubtreeOf` | string | anchor is the session or one of its ancestors (self-inclusive) |
| `isLeaf` | boolean | no session names it as a parent — checked against the whole table, not just the page |
| `status` | `running` \| `idle` \| `unknown` | live running set, else host status, else recorded `time_idle` / `idle_outcome` |
| `hasPendingForm` | boolean | `pending[sid].forms` non-empty on the host |
| `archived` | boolean | `time_archived` present |
| `claimed` | boolean | `time_suspended` present — the marker `SessionStore.claim` writes at turn start |
| `orphaned` | `true` \| `false` \| `null` | `claimed ∧ ¬running` — the row holds a claim but the host's active set (`GET /api/session/active`) does not list it. `null` (unknown) when the host was not read; never reported as `false` |
| `project` | string | `session_v2.project_id` |
| `outcome` | `succeeded` \| `failed` \| `interrupted` \| `none` | `session_v2.idle_outcome` |
| `fork` | boolean | `fork_session_id` present |
| `scheduled` | boolean | `metadata.openchamber.kind === "scheduled"` |
| `lastActivity` | epoch-ms, ISO, or `{after,before}` | `max(time_updated, time_idle)` |

### Known unavailable

Two filters have **no source** and are reported under `meta.unavailable` with their reason instead of being guessed. No session row carries either field, and requesting one as a filter fails loudly.

| Field | Why it is unavailable |
|---|---|
| `userSpawned` | `session_v2` has no spawn-provenance column, and neither host endpoint reports who created a session. "Root and not a fork and not scheduled" is a proxy for it, not the thing itself. |
| `waveIndex` | Wave or batch membership is recorded nowhere — not on the session row, not by the host. `depth` answers "how deep", not "which wave". |

### Data sources and honesty rules

- **Inventory** — `session_v2`, paged newest-first with a default cap of 2000 (`--all` pages everything). Child counts and ancestor chains come from the whole table, so `depth`, `rootId` and `isLeaf` stay correct even when the page is capped, and `meta.truncated` says the page was capped.
- **Live overlay** — `/api/session/active` (running ids) and `/api/sessions/status` (per-session status and `pending[sid].forms[]`). `/api/form` is directory-scoped and is deliberately **not** used.
- **Degradation** — when the host is unreachable the projection still returns database rows, sets `meta.stale: true`, and warns that pending forms are unknown **and that orphan detection is unavailable** (`orphaned` stays `null`, never `false`). It never reports "no pending forms" or "no orphaned claims" as facts it did not observe.
- **Auth** — the CLI reads the host runfile (`~/.config/openchamber/run/openchamber-<port>.json`) in process, sends that password only to a loopback host, and never prints it or puts it in argv.
## Dashboard (design only — not implemented)

There is **no dashboard in this repository.** `docs/design/` holds a design sketch only:

- [`docs/design/agent-manager-dashboard.excalidraw`](./docs/design/agent-manager-dashboard.excalidraw) — a 76-element Excalidraw sketch of a possible Agent Manager dashboard. Open it at [excalidraw.com](https://excalidraw.com) → *Open*, or with the VS Code Excalidraw extension.
- [`docs/design/agent-manager-dashboard.md`](./docs/design/agent-manager-dashboard.md) — the one-paragraph pointer to that file.
- [`docs/superpowers/specs/2026-11-10-agent-manager-dashboard-design.md`](./docs/superpowers/specs/2026-11-10-agent-manager-dashboard-design.md) — the design spec and data-contract notes behind the sketch.

No implementation is approved, no dashboard code ships here, and `sidebar-view.mjs` is not that dashboard — it is a terminal/JSON view over an existing OpenChamber UI.

## Known limitations

- **Session origin cannot be determined.** OpenCode records no column, field, hook, or event that says who or what created a session, so `userSpawned` has no source and `default` is a **labelled proxy** for "conversations you started" rather than the thing itself. The full `metadata.openchamber.*` inventory, the writer for each key, and the source citations behind this limitation are in [`docs/opencode-session-metadata.md`](./docs/opencode-session-metadata.md).
- Journal entries are JSON values in OpenCode plugin storage, not SQLite session history. There is no compare-and-swap primitive in the documented storage interface; appends from separate server processes are not guaranteed atomic.
- `tree_family` uses a bounded walk (default 200 nodes, maximum 2,000). A large family may be truncated; the response marks that condition.
- Parent links to missing/deleted sessions terminate the upward walk at the missing ID. Corrupt cycles are detected and bounded.
- `tree_handoff` reports `finished` only when the child's recorded outcome is `succeeded`; `failed`, `interrupted`, or absent outcomes are reported as `died`. It accepts descendants in the caller's family (not unrelated sessions) and delivers to the child's direct parent.
- The `tool.execute.after` hook runs after a tool execution. If a process is killed before that hook, it cannot record the result. Provider failures are journaled when OpenCode reaches the `session.retry` policy hook; failures outside that provider retry path are not covered by a general terminal-failure hook.
- The child tool name and child-ID payload are implementation details, not a stable public API. Hook matching is intentionally defensive; check logs after OpenCode upgrades.
- Model and agent fields reflect the session metadata OpenCode returns; this plugin does not pin or change child models.
- `tree_status` reads a capped inventory by default (2000 rows, newest first) and says so with `meta.truncated`; pass `--all` or a larger `limit` when a view must be exhaustive. Child counts and ancestor chains are read from the whole table, so `depth`, `rootId` and `isLeaf` are correct even when the page is capped.
- `tree_status` needs the host for run state, pending forms, and orphan detection. Without it the projection is database-only, sets `meta.stale: true`, reports pending forms as unknown rather than absent, and leaves `orphaned` as `null` with an explicit "orphan detection unavailable" warning — the orphan arm of `needs-restart` contributes nothing until the host is reachable, while recorded failures still list from the database. `userSpawned` and `waveIndex` have no source at all and are reported as unavailable.
- Initial live integration failed with `Tool result declared output without an output schema`. The V2 runtime's execution branch rejects a returned object that owns `output` when the tool has no output schema; the earlier content-only adapter did not explain why that live path observed `output`. All registered tools declare the V2 object output schema and return structured `output` plus readable `content`. Post-change calls in the already-loaded shared service still returned the same error, and its catalog still advertises the old handoff description; the source fix is not live-verified because the shared service was not restarted or reloaded.
- The shared database already contained one historical failed `opencode-go/deepseek-v4.1-flash` child (`Go usage limit exceeded`). It predates this plugin installation, so it did not produce a plugin hook journal entry. A separate free-tier failure was captured by the live `subagent` hook, but its child ID was only embedded in the error text; the current source now extracts IDs from that text, and this adjusted hook behavior has not yet been re-triggered live.

## Development

```sh
npm install
npm test
npm run typecheck
```

Tests cover journal concurrency, identity derivation, sibling-inclusive trees, recursive recovery and NRR discovery, truncation, cycle defense, handoff formatting, and tool handlers. Live-server behavior must still be rechecked after changing OpenCode versions.

## Status

Early-stage (0.1.x) and not affiliated with or endorsed by the OpenCode project. The plugin's live behavior depends on OpenCode V2 runtime internals that are not a stable public API — see [Known limitations](#known-limitations) before relying on it.

## License

[MIT](./LICENSE) © 2026 Jordan Christley
