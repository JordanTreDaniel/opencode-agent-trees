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
| `running` | `status = running` | A turn in flight or holding the execution claim: `running`, `retrying`, `waiting-permission`, `waiting-question`. **Question-paused sessions are a subset** — views.json says a paused session still reports running, and `question-paused = running ∧ hasPendingForm` requires it. |
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
- **`fork`, `scheduled`, `claimed`, `pendingForm` are not sent by OpenChamber 2.6.1.**
  The panel reads them when present (the preview fixtures supply them) and reports
  `fork: unknown` / `scheduled: unknown` / `orphaned: unknown` when absent, widening the
  default proxy rather than hiding rows. This is the same widening `views.json` documents
  for absent metadata.
- **`hasPendingForm` is derived from `activity === waiting-question`** (or an explicit
  `pendingForm` flag when the host sends one). The host exposes no pending-form set, so a
  stale form on an idle session is only visible when the flag is present; either way it
  cannot match `question-paused`, because that view also requires `status = running`.
- **`outcome.interrupted` can never match**: the host vocabulary is
  `completed | failed | null` (mapped to `succeeded | failed | none`). The gap card says so
  on every screen.
- **`running` includes question-paused sessions.** This is forced by views.json, not a
  choice: `question-paused` is defined as `status = running ∧ hasPendingForm`, so a paused
  session must report `running` to be findable at all. The running view's note states the
  subset relationship instead of hiding it.
- **`tree:` / `subtree:` are ordered by derived depth, then lastActivity.** views.json
  declares `lastActivity desc` for those two views; the panel sorts by depth so the tree
  shape is legible. This is the single deliberate divergence from the declared sort and
  lives only in `sortSessionsByDepth`.
- **`userSpawned` and `waveIndex` have no source at all** (see `views.json` for the full
  reason). The default view is therefore a proxy, and the UI never claims otherwise.

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

### Visual proof

```bash
node preview/shoot.mjs    # needs Playwright (devDependency) + chromium
```

Writes desktop 1440×900 shots of all six views, mobile 390×844 of default and
question-paused, element close-ups of the view switcher / proxy label / filter vocabulary,
and the `orphaned: unknown` variant. Default output directory:
`/Users/jordanc/dev/opencode-v2-test/tmp/opencode/extension-proof/`. The script asserts the
vocabulary renders exactly 20 rows with `userSpawned` and `waveIndex` marked unavailable,
and it fails on any console/page error.

## Verification run (2026-11-12)

- `npm test` (repo root): 96/96 pass — the extension is outside `src/` and `test/`.
- `npm run typecheck` (repo root) and `npx tsc -p extension/tsconfig.json`: clean.
- `bunx openchamber-guest-bundle panel/main.ts panel/main.js`: builds, no errors.
- Playwright screenshots captured with **zero console/page errors** at desktop and mobile;
  vision review of every screenshot: PASS (see the session report for the per-file table).
