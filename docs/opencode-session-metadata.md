# OpenCode session metadata — `metadata.openchamber.*` inventory

Every key OpenChamber writes into an OpenCode session's `metadata.openchamber` namespace, who writes it, and how many rows carried it in one local database at one moment.

**Snapshot:** 2026-11-12T03:29:46Z (2026-11-11, 21:29 America/Chicago), read-only, from `/Users/jordanc/dev/opencode-v2-test/xdg/data/opencode/opencode.db`: 11,066 `session_v2` rows, 10,523 of them carrying `metadata.openchamber`.

**These counts are a point-in-time sample, not a contract.** The table grows continuously while OpenChamber runs. An earlier sample the same day read `work` 10,276 / `turn` 5,617 / `pinned` 816 / `assist` 490; roughly ten minutes later the same keys read 10,288 / 5,627 / 826 / 492. Treat every count below as "at snapshot time", and re-query rather than trusting a number in prose.

Source paths are relative to two checkouts:

- **OpenChamber** — `~/dev/openchamber-src/packages/`
- **OpenCode** — `~/dev/opencode-src/packages/` (tag `v2.1.2`, the version this plugin targets)

## Session-level keys

| Key | Meaning | Writer (file:line) | Live count |
|---|---|---|---|
| `work` | In-work lifecycle `{state, openedAt, openedBy, doneAt, suggestDoneAt}`. `openedBy` records who **opened the tab** — `auto` when a message was sent, `user` when the user pressed Track (`jev` on older records) — **not** who created the session. | `ui/src/lib/sessionWorkMetadata.ts:11-18` (shape), `:68-79` (`user` writer); `web/server/lib/session-work/state.js:38` (`auto` writer) | **10,288** — `auto` 10,287 / `user` 1; `doneAt` present on 22; `suggestDoneAt` on 0 |
| `turn` | Last-turn `{endedAt, durationMs}`, stamped when a turn ends. | `ui/src/lib/sessionTurnMetadata.ts:5-14` (shape); `web/server/lib/openchamber-sessions/turn-duration.js:39-40` (writer) | **5,627** |
| `pinned` | Sidebar pin `{at, list?}`. `list` names the "Pin to" list; absent means the default Pinned list. | `ui/src/lib/sessionPins.ts:8` (doc), `:27` (shape), `:59-60` (writers) | **826** — 0 of them carry `list` |
| `goal` | Goal Mode objective record: `{id, objective, objectiveFile, status, tokensUsed, turnsUsed, blockedStreak, note, statusReason, lastAccountedMessageID, createdAt, updatedAt}` plus `tokensBaseline`/`tokensCommitted`/`auditFailStreak`/`evaluationProviderID`/`evaluationModelID` on 374. | `ui/src/lib/sessionGoalMetadata.ts:40-42` (reader); `web/server/lib/openchamber-sessions/routes.js:939` (writer); `ui/src/lib/sessionForkInheritance.ts:70` (fork rewrite) | **632** |
| `assist` | Jev hints `{recap, suggestion, forMessageID, generatedAt}`. | `ui/src/lib/sessionAssistMetadata.ts:20` (reader); `web/server/index.js:1073` (writer) | **492** |
| `kind` | Flow discriminator. Values written: `scheduled` (a cron run — nobody sent it), `btw` (a `/btw` fork), `review` (an auto-review session), `workflow-agent` (a workflow-created agent). | `web/server/lib/scheduled-tasks/runtime.js:783` (`scheduled`); `ui/src/lib/sessionBtwMetadata.ts:95` (`btw`); `ui/src/lib/sessionReviewMetadata.ts:59` (`review`); `web/server/lib/workflows/agent-session.js:57` (`workflow-agent`) | **135** — `scheduled` 134, `btw` 1, `review` 0, `workflow-agent` 0 |
| `btwSessionID` | Parent session → its active `/btw` fork. | `ui/src/lib/sessionBtwMetadata.ts:76-81` | **50** |
| `btwBoundaryMessageID` | The boundary message the `/btw` fork split at. | `ui/src/lib/sessionBtwMetadata.ts:96` | **1** |
| `originalSessionID` | The session a fork came from (`btw` or `review`). | `ui/src/lib/sessionBtwMetadata.ts:95` (btw); `ui/src/lib/sessionReviewMetadata.ts:60` (review) | **1** |
| `reviewSessionID` | Original session → its review session (the inverse link). | `ui/src/lib/sessionReviewMetadata.ts:49-53` (`withReviewSessionLink`) | **0** |
| `project_context_pins` | Draft notes/plans pins carried into a newly created session. `{notes: [], plans: []}`. | `ui/src/sync/session-ui-store.ts:1168-1173` (writes at `:1171`) | **1** |
| `context_obligatory_messages` | User-pinned messages re-injected after a compaction. | `ui/src/lib/contextObligatoryMessages.ts:55-61` (writes at `:59`) | **1** |
| `context_obligatory_last_compaction_message_id` | Cursor: the last compaction the re-injection ran against. | `web/server/lib/context-obligatory/runtime.js:135` | **0** |
| `workTitle` | `{title, by: 'user'}` — the user named the session. | `ui/src/lib/sessionWorkTitle.ts:20-22`; `web/server/lib/openchamber-sessions/routes.js:346` | **0** |
| `reviewOffer` | `{at}` — Jev offered a review of the finished work. | `web/server/lib/session-work/state.js:48` (writer); `ui/src/lib/sessionWorkMetadata.ts:46-55` (shape/reader) | **0** |
| `btwPromoted` | The `/btw` fork was promoted to a normal session. | `ui/src/lib/sessionBtwMetadata.ts:114` | **0** |
| `multirun` | Multi-run membership (`{title}` and friends). | `ui/src/lib/multirun/identity.ts:107-114` (writes at `:112`) | **0** |
| `linked_issues` | Linked tracker issues on the session. | `ui/src/lib/linkedIssues.ts:524-530` (writes at `:526`) | **0** |

Seven keys are written by the code but carried **zero rows** in this sample: `reviewSessionID`, `context_obligatory_last_compaction_message_id`, `workTitle`, `reviewOffer`, `btwPromoted`, `multirun`, `linked_issues`. Zero rows means "not used in this database", not "never written anywhere".

`work` and `pinned` both have optional fields that were also unused here: `work.suggestDoneAt` (0 rows) and `pinned.list` (0 rows).

## Message-level keys — not session metadata

These live on a **message**, not on the session row. They cannot be read from `session_v2` and they are not part of the inventory above.

| Key | Meaning | Writer (file:line) | Live count |
|---|---|---|---|
| `promptedBy` | `{sessionID, title?}` on a user message — which session sent this prompt, when OpenChamber's agent tool used `session.create` / `session.send` / `session.fork`. `title` is a fallback name for a reader that cannot see the sender now. A message with no `promptedBy` was written by the human. | `ui/src/lib/opencode/prompt-origin.ts:1-33` (reader, shape at `:20-27`); `web/server/lib/openchamber-sessions/routes.js:987` (writer) | **28** messages of 220,684 |
| `schemaVersion`, `action`, `description`, `ok`, `answer` | Tool-result call metadata written by the agent-tool adapter so every client shows the page as answered after a reload. | `web/server/lib/agent-tool/runtime.js:474`, `:633`, `:658` | **360** messages contain `schemaVersion` |

## Why there is no `createdBy`

**Session origin is not identifiable in OpenCode. There is no column, no field, no hook, and no event that records who or what created a session.** Everything below is read from the `v2.1.2` source at `~/dev/opencode-src/packages/`.

- **The `session_v2` table has no origin column.** `core/src/session/sql.ts:22-68` defines every column the table has: `id`, `project_id`, `workspace_id`, `parent_id`, `fork_session_id`, `fork_boundary`, `slug`, `directory`, `path`, `title`, `version`, `share_url`, `summary_*`, `metadata`, `cost`, `tokens_*`, `revert`, `permission`, `agent`, `model`, the timestamps, `idle_outcome`, `time_compacting`, `time_archived`, `time_suspended`, `resume_attempts`. There is no `source`, `origin`, `created_by`, `actor`, `via`, `channel`, or `client`. A live `PRAGMA table_info(session_v2)` on the snapshot database returns exactly that list and nothing else.
- **`Session.Info` has no source field either.** `schema/src/session.ts:32-60` is `id`, `parentID`, `fork`, `projectID`, `agent`, `model`, `cost`, `tokens`, `outcome`, `time`, `title`, `location`, `subpath`, `metadata`, `permissions`, `revert`. Provenance is simply not part of the session record the API returns.
- **The create payload cannot carry it.** `protocol/src/groups/session.ts:156-166` accepts exactly `id`, `parentID`, `title`, `agent`, `model`, `location`, `metadata`, `permissions`. There is no origin field to send even if a client wanted to.
- **Auth collapses to a boolean, so the caller is not recorded either.** `server/src/middleware/authorization.ts:58-62` reduces every request to `authorized: boolean`. `server/src/auth.ts:19-37` hardcodes the username to `"opencode"` (`:20`) and `authorized()` returns `false`/`true`, accepting a pairing-link session token in place of the password (`:36`, `verifySession`). Nothing in that path identifies a principal beyond "passed" or "failed".
- **There is no `session.create` plugin hook.** The whole `session` hook surface is `prompt`, `context`, `compaction`, `generate`, `title`, `model.request`, `http.request`, `http.response`, `experimental.ws.*`, `retry` (`plugin/src/effect/session.ts:139-151`). A plugin cannot intercept creation and stamp anything.
- **The one lifecycle event that exists, `session.created`, carries no origin field.** It is a durable event (`schema/src/session-event.ts:48-66`), not a hook, and its schema is `projectID`, `location`, `subpath`, `parentID`, `slug`, `title`, `agent`, `model`, `metadata`, `permissions`, `version`. It does carry `metadata` (`:62`, "Host-supplied annotations resolved at creation, including any inherited from a parent") — but `metadata` is host-supplied, and **no writer puts an origin marker in it** (see the inventory above: every key describes state, flow, or links, never provenance). So the event tells you a session appeared; it never tells you who made it appear.
- **Metadata is inherited, so it actively misreports.** `schema/src/session-metadata.ts:3-6`: "Children and forks inherit the parent's current metadata unless the creator supplies its own." An agent subsession created by the `subagent` tool therefore carries whatever namespace its host already had — which reads as the host's flow label, not its own.
- **`opencode run` writes no metadata.** `packages/cli/src/session-target.ts:60-68` calls `session.create` with only `id`, `agent`, `model`, and `location`. The maintainer confirmed this gap in issue #40384 on 2026-10-28: "`opencode run` still creates its session without metadata (`resolveSessionTarget()` in `packages/cli/src/session-target.ts`). It sets no default `origin` marker and has no flag to pass your own metadata."
- **OpenChamber's default create writes none either.** `ui/src/sync/session-actions.ts:1084-1088` passes `metadata: sessionMetadata`, where `sessionMetadata` is `undefined` unless the draft carries a user title (`withUserWorkTitle`) or project-context pins (`ui/src/sync/session-ui-store.ts:1168-1173`). Neither is an origin marker.

Metadata *could* carry origin: `session.update` is a real endpoint (`protocol/src/groups/session.ts:298`, `PATCH /api/session/:sessionID`) and OpenChamber writes every key in the table above through it (`web/server/lib/openchamber-sessions/session-metadata-store.js:78`). The write path exists. Nothing writes provenance down it.

**Consequence: `userSpawned` is unavailable.** No field distinguishes a conversation the user started from one `opencode run`, an SDK call, or a script started. The `default` view (`isRoot ∧ ¬fork ∧ metadata.openchamber.kind ≠ "scheduled"`) is therefore a **labelled proxy**, not the thing itself: it excludes only the one flow someone chose to label, and every unlabelled root — including every `opencode run` root — counts as user-started by default. See [README § Views](../README.md#views) and [README § Known unavailable](../README.md#known-unavailable).

## Upstream state

| Item | State | Dates |
|---|---|---|
| [Issue #40384](https://github.com/anomalyco/opencode/issues/40384) — *Expose session metadata in the V2 API so programmatic run sessions are attributable* | **OPEN** | opened 2026-08-04; maintainer reply 2026-10-28 |
| [PR #48059](https://github.com/anomalyco/opencode/pull/48059) — *feat(session): expose metadata in V2 API and mark run origin* | **CLOSED, unmerged** (`mergedAt: null`) | closed 2026-09-09 |
| [PR #47486](https://github.com/anomalyco/opencode/pull/47486) — *fix(opencode): run live metadata updates from plugin tools* | **CLOSED, unmerged** (`mergedAt: null`) | closed 2026-10-10 |
| [Issue #53779](https://github.com/anomalyco/opencode/issues/53779) — *include `slug` on SessionInfo (v2), so plugins can name sessions they did not see created* | **OPEN** | opened 2026-10-07 |

The 2026-10-28 maintainer reply (opencodejr) says `session.create` now takes `metadata`, `Session.Info` returns it, and `PATCH /api/session/:sessionID` lets you set it after creation — but "the part still missing is the CLI", and "Maintainers will consider adding that." No origin marker has landed.

## Reproducing the counts

Read-only, one query per key. `metadata` is a JSON text column, so the counts are a scan:

```sql
SELECT COUNT(*) FROM session_v2
WHERE json_extract(metadata, '$.openchamber.work') IS NOT NULL;
```

Or enumerate every key in one pass by parsing `metadata` as JSON and tallying `Object.keys(JSON.parse(metadata).openchamber)`. Counts move while OpenChamber runs — record the timestamp with any number you quote.
