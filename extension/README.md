# Session Views — OpenChamber extension

Renders the six session views declared in [`src/lib/views.json`](../src/lib/views.json) as a
full-screen OpenChamber page (and a rail panel): **default (proxy)**, **running**,
**needs-restart**, **question-paused**, **tree:\<rootId\>**, **subtree:\<id\>**.

```
extension/
  package.json          manifest (openchamber block) + SDK pin + scripts
  tsconfig.json         typecheck for panel/ + preview/
  panel/
    index.html          guest document (CSP comes from the host / preview server)
    main.ts             entry: connectHost + applyHostReady + mountApp
    views.ts            imports src/lib/views.json — the ONLY view/filter definition
    selector.ts         DUPLICATED selector: projection, matches(), sort
    data.ts             workspace bridge → records, coverage, data-gap list
    app.ts              view switcher, proxy caveat, rows, vocabulary panel
    styles.ts           panel CSS (host theme tokens only)
    main.js             built bundle (IIFE) — ship this, not main.ts
  preview/
    index.html          mock-host page; iframes ../panel/index.html
    host.ts / host.js   mock guest-protocol bridge (hello→ready, workspace-*)
    fixtures.json       ~20 synthetic sessions covering every view
    server.mjs          static server; sends the real guest CSP on /panel/*.html
    shoot.mjs           Playwright screenshot routine (the visual proof)
```

## Build

```bash
cd extension
npm install
export PATH="$HOME/.bun/bin:$PATH"
bunx openchamber-guest-bundle panel/main.ts panel/main.js     # the panel
bunx openchamber-guest-bundle preview/host.ts preview/host.js # the preview host only
npx tsc -p tsconfig.json --noEmit                             # typecheck
```

`bunx openchamber-guest-bundle` is the SDK's bundler (a Bun wrapper around `bun.build`).
Any bundler that emits a classic IIFE works — the guest iframe cannot load ES modules.

## Install into OpenChamber

1. Build `panel/main.js` (above).
2. Open **Settings → Extensions → Add**.
3. Choose the **folder** `…/opencode-agent-trees/extension` (edit → rebuild → reload works),
   or zip the folder (ship `package.json`, `panel/index.html`, `panel/main.js`; skip
   `node_modules`, `preview/`, `*.ts`) and pick the zip.
4. Approve the single capability the manifest asks for: **`sessions`**
   (list projects/sessions and open a session). Granted once, at install.
5. Open it from the sidebar **Extension pages** menu (`contributes.page`), or from the rail
   icon (`panel.entry`).

The extension opens on the **default** view first, because the standing requirement is
"always look at root-sessions-spawned-by-user by default".

> **This folder is not installed into the running OpenChamber instance.** It was verified
> only through the preview harness below. Upstream OpenChamber is issue-gated, so no PR is
> opened for it.

## The six views

| View | Definition (from `views.json`) | What it means here |
|---|---|---|
| `default` | `isRoot ∧ ¬fork ∧ ¬scheduled`, `isProxy: true` | **A documented proxy, not the truth.** Labelled `PROXY — best guess` in the UI with the literal caveat *best guess — includes workflow/queue/API sessions*, because `userSpawned` has no source anywhere. |
| `running` | `status = running ∧ ¬hasPendingForm` | **Actively producing**: `running`, `retrying`, `waiting-permission` — a turn in flight or holding the execution claim. **Question-paused sessions are excluded**: `running` and `question-paused` are disjoint (opposite `hasPendingForm` values on the same `status = running`) and together cover every running row. |
| `needs-restart` | `¬archived ∧ (outcome ∈ {failed, interrupted} ∨ orphaned)` | Failed/interrupted outcome, or an orphaned claim. When claim state is unreadable the UI shows **`orphaned: unknown`** plus a warning and says explicitly that the rows come from recorded outcomes only — it never reports zero. |
| `question-paused` | `status = running ∧ hasPendingForm` | The verification surface for pause/resume: pause reports `paused` only after a new pending form *and* the claim are observed; resume reports `resumed` only after the form leaves the pending set. |
| `tree:<rootId>` | `rootId = <id>` | Every session in one tree, **ordered by derived depth** with per-row indentation. |
| `subtree:<id>` | `isSubtreeOf = <id>` (self-inclusive) | One session and everything beneath it, ordered by derived depth. |

The filter vocabulary panel (footer of every screen) lists all 20 filters with their type,
derivation and availability. `userSpawned` and `waveIndex` are rendered **unavailable**
(red, struck through, `unavailable` chip, reason text) — never silently omitted. Filters
the host cannot supply today (`claimed`, `orphaned`, `fork`, `scheduled`) switch between
`derived` and `unknown on this host` depending on what the live host actually sent.

## Single source of truth — and the one thing that is duplicated

`panel/views.ts` **imports `src/lib/views.json` into the bundle**. No view, filter set,
sort order or proxy note is re-declared in the extension; change `views.json` and rebuild.

Duplicated on purpose: the **selector implementation** in `panel/selector.ts`
(`projectSessions`, `matches`, `sortSessions`, `sortSessionsByDepth`, plus `resolveView`
in `views.ts`). `src/lib/status.ts` evaluates the same vocabulary against SQLite +
`/api/session/active` + `/api/sessions/status`; the panel runs in a sandboxed iframe with
no filesystem and no raw network, so it evaluates it against the OpenChamber workspace API
(`listProjects` / `onSessions`). **Drift is possible only in the selector, not in the
definitions** — if you change a filter's semantics in `src/lib/status.ts`, port the same
change into `extension/panel/selector.ts`.

## Known gaps (be loud about all of these)

- **The panel derives `depth`, `rootId`, `isLeaf`, `inTree` and `childCount` itself.** The
  host workspace record carries only `id, parentId, projectId, directory, createdAt,
  updatedAt, archivedAt, activity, outcome, title`. Depth is a `parentId` walk (cycle-guarded,
  max 256 hops); a parent the host did not list ends the walk. Any session whose parent is
  outside the reported inventory will show a shallower depth than the DB projection would.
- **`fork`, `scheduled`, `claimed`, `pendingForm` are not sent by OpenChamber 2.6.1 — verified
  against the host source, not assumed.** The workspace projection builds each record from a
  literal object that contains none of them
  (`openchamber-src/packages/ui/src/lib/guests/workspace.ts:60-76`), the wire type carries none
  (`openchamber-src/packages/sdk/src/workspace.ts:19-37`), the wire schema accepts none
  (`openchamber-src/packages/sdk/src/workspace-schemas.ts:20-28`), and `API.md:218` documents
  exactly the fields below. The host's own `Session` type *does* carry `metadata`
  (`packages/ui/src/lib/opencode/model.ts:159`) and `fork.sessionID`
  (`packages/ui/src/lib/opencode/model.ts:162-165`) — they are simply never projected onto the
  guest record. The panel therefore reports `fork: unknown` / `scheduled: unknown` /
  `orphaned: unknown` when absent and widens the default proxy rather than hiding rows; it
  never fabricates a value. Note the guest runtime would *pass an unknown key through* if a
  future host sent one (`packages/sdk/src/contract.ts:869` only checks envelope + discriminant),
  so wiring `scheduled` to `metadata` later is a panel-side change, not an SDK bump — today
  there is nothing to wire it to.
- **`hasPendingForm` is derived from `activity === waiting-question`** (or an explicit
  `pendingForm` flag when the host sends one). The host exposes no pending-form set, so a
  stale form on an idle session is only visible when the flag is present; either way it
  cannot match `question-paused`, because that view also requires `status = running`.
- **`outcome.interrupted` can never match**: the host vocabulary is
  `completed | failed | null` (mapped to `succeeded | failed | none`). The gap card says so
  on every screen.
- **`running` excludes question-paused sessions on purpose (views.json, not a panel
  choice).** `running = status = running ∧ ¬hasPendingForm`, `question-paused =
  status = running ∧ hasPendingForm`: disjoint, and together they cover every `status = running`
  row. The panel derives `hasPendingForm` from `activity === waiting-question` (or the explicit
  `pendingForm` flag when a host sends one), so the split works on a live install too. One
  ordering caveat: the host sets `activity` to `waiting-permission` **before** it checks forms,
  so a session holding both a permission prompt and a form reads as `running` here and not as
  question-paused.
- **`tree:` / `subtree:` are ordered by derived depth, then lastActivity.** views.json
  declares `lastActivity desc` for those two views; the panel sorts by depth so the tree
  shape is legible. This is the single deliberate divergence from the declared sort and
  lives only in `sortSessionsByDepth`.
- **`userSpawned` and `waveIndex` have no source at all** (see `views.json` for the full
  reason). The default view is therefore a proxy, and the UI never claims otherwise.

## What a live host record actually carries (verified 2026-11-12)

`listSessions(projectId)` / `onSessions(projectId, …)` return `GuestSessionsSnapshot`. The
snapshot is `{ kind, projectId, state, coverage[], sessions[] }`
(`packages/sdk/src/workspace.ts:41-45`); each session record carries **exactly**:

| Field | Notes | Source |
|---|---|---|
| `id`, `title`, `projectId`, `directory` | identity | `workspace.ts:19-23` |
| `agent?` | omitted by hosts older than the field | `workspace.ts:24-25` |
| `parentId` | parent link — **not** fork origin | `workspace.ts:26` |
| `createdAt`, `updatedAt`, `archivedAt` | epoch ms / `null` | `workspace.ts:27-29` |
| `worktree` | `GuestWorktree \| null` | `workspace.ts:30` |
| `activity` | `unknown \| idle \| running \| retrying \| waiting-permission \| waiting-question` | `workspace.ts:31` |
| `outcome` | `completed \| failed \| null` | `workspace.ts:33` |
| `items` | this extension's own opaque references | `workspace.ts:34` |
| `links?` | read-only thread links; omitted by older hosts | `workspace.ts:35-36` |

Built by the host in `packages/ui/src/lib/guests/workspace.ts:60-76`; identical key list in
the wire schema `packages/sdk/src/workspace-schemas.ts:20-28` and in prose at
`packages/sdk/API.md:218`.

- **`metadata`: ABSENT** — the verdict. `projectSession` returns a literal object with no
  `metadata` key (`packages/ui/src/lib/guests/workspace.ts:60-76`) even though the host's
  `Session` type has one (`packages/ui/src/lib/opencode/model.ts:159`). So
  `metadata.openchamber.kind === 'scheduled'` is **not detectable on a live install**, the
  `default` view's `¬scheduled` arm is inert in the panel, and the panel widens.
- **Fork origin: ABSENT.** No field reveals it — `fork.sessionID` exists only in core
  `Session.Info` (`packages/ui/src/lib/opencode/model.ts:162-165`) and is never projected;
  `parentId` answers a different question. The panel's `¬fork` arm is likewise inert.
- **`claimed` (execution claim): ABSENT** — `time_suspended` never reaches the record, so
  `orphaned` stays `null` and `needs-restart`'s orphan arm is unevaluable (the gap card says
  so rather than reporting zero).
- **`pendingForm`: ABSENT as a flag, but its live meaning is derivable** — the host sets
  `activity = waiting-question` from its own form store
  (`packages/ui/src/lib/guests/workspace.ts:58`), which is what the panel uses.

### Degradation table — per view, on a live install

| view | fully works on a live install? | what degrades | why (field absent) |
|---|---|---|---|
| `default` | **No** (root-only, widened) | `¬fork` and `¬scheduled` exclusions never fire; scheduled/queue roots are included | `fork` (`…/guests/workspace.ts:60-76`), `metadata` (`…/guests/workspace.ts:60-76`) |
| `running` | **Yes** | none material; caveat: a session holding a permission prompt *and* a form reads as running, not question-paused | `pendingForm` flag absent — but `activity` covers the pause case; host checks permission before forms (`…/guests/workspace.ts:55-58`) |
| `question-paused` | **Yes** | a stale form on a non-waiting activity is invisible | `pendingForm` flag absent (`…/guests/workspace.ts:60-76`); `activity` is the only signal |
| `needs-restart` | **Partial** | orphan arm unevaluable → `orphaned: null` + gap card, never "zero orphans"; the `interrupted` arm can never match | `claimed`/`time_suspended` absent (`…/guests/workspace.ts:60-76`); host outcome vocabulary is `completed\|failed\|null` (`API.md:222`) |
| `tree:<root>` / `subtree:<id>` | **Yes** | depth/rootId derived by a `parentId` walk; a parent the host did not list ends the walk | host sends no depth (`workspace.ts:19-37`) |

## Preview harness (the extension is NOT installed into OpenChamber)


```bash
cd extension
node preview/server.mjs            # http://127.0.0.1:4173/preview/
```

`preview/index.html` plays the host side of the guest wire protocol
(`openchamber.sdk` / `v: 1`): `hello → ready`, `workspace-read`, `workspace-subscribe`,
`open-session`, `toast`. It iframes `../panel/index.html`, so **the panel code that runs in
the preview is byte-identical to the panel code that ships** — there is no preview-only
branch in `panel/`. The preview server also answers `/panel/*.html` with the production
guest CSP (`guestFramePolicy(null)`), so the panel runs under the real network lockdown.

- `preview/fixtures.json` — 20 synthetic sessions across 2 projects covering every view:
  a failed-idle session, a claimed orphan, a claimed-and-running session, a stale-form
  session, two normal paused sessions, a fork root, a scheduled-kind root, an archived
  failure (must stay out of `needs-restart`), a `waiting-permission`, a `retrying`, an
  `unknown`, a workflow/queue root that the proxy must (wrongly) include, and a depth-4 tree.
  Timestamps are ages so the fixture never expires.
- The **supply fixture provenance** checkbox strips `fork / scheduled / claimed /
  pendingForm` from every record and re-pushes the snapshots — that is the production-shape
  path: `orphaned: unknown`, `fork: unknown`, `scheduled: unknown`, `default` widens to 9.
- **`?empty=1`** drops every session that would land in `question-paused` (a live form) or
  `needs-restart` (a failed outcome or an execution claim) — 11 of the 20 fixture sessions —
  so both views render their empty state against a workspace whose other views still have
  rows. Nothing in `panel/` knows about the flag; only the mock host filters.

### Visual proof

```bash
node preview/shoot.mjs [outdir]              # every shot (default dir below)
node preview/shoot.mjs [outdir] --only=a,b   # only the named shots
```

Writes desktop 1440×900 shots of all six views, mobile 390×844 of default and
question-paused, element close-ups of the view switcher / proxy label / filter vocabulary,
the `orphaned: unknown` variant, and — with `?empty=1` on the preview URL — the forced empty
state of `needs-restart` and `question-paused` (provenance on and off). Default output
directory: `/Users/jordanc/dev/opencode-v2-test/tmp/opencode/extension-proof/`. The script
asserts the vocabulary renders exactly 20 rows with `userSpawned` and `waveIndex` marked
unavailable, and it fails on any console/page error.

When the running/question-paused shots run, it also asserts the **disjointness contract on the
rendered rows**: `running ∩ question-paused = ∅`, `running + question-paused == every fixture
session whose activity is a running one` (5 + 2 == 7), and both memberships match what the
selector's rules predict. The `?empty=1` shots assert the workspace still renders rows in
`default` first, so an empty view proves the empty state rather than an empty fixture.

## Verification run (2026-11-12, after the running/question-paused split)

- `npm test` (repo root): 97/97 pass — including *"running and question-paused are disjoint and
  partition every status = running row"* (`test/status.test.ts`), which asserts the two
  definitions from `src/lib/views.json` and proves `running.count + question-paused.count ==
  count(status = running)` with zero overlap on a fixture holding both a running session and a
  running+question-paused one. The extension itself is outside `src/` and `test/`.
- `npm run typecheck` (repo root) and `npx tsc -p extension/tsconfig.json`: clean.
- `bunx openchamber-guest-bundle panel/main.ts panel/main.js` **and**
  `bunx openchamber-guest-bundle preview/host.ts preview/host.js`: build, no errors.
- Playwright: the affected shots re-captured with **zero console/page errors** —
  `desktop-running`, `desktop-question-paused`, `mobile-question-paused`,
  `desktop-empty-needs-restart`, `desktop-empty-question-paused`,
  `desktop-empty-needs-restart-provenance-off` — plus the in-script disjointness assertion on
  the rendered rows (5 + 2 == 7, no overlap, union == all). Vision review: see the session
  report for the per-file table.
