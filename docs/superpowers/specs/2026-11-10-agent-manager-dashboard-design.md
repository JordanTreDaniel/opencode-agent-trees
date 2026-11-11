# Agent Manager Dashboard — Design

**Status: awaiting Jordan’s approval.** This document describes an MVP; it does not authorize implementation.

## Intent and goals

Give Jordan a trustworthy overview of conversations, parent/child tree shapes, work status, and sessions that may be restart candidates. Match OpenChamber 2.5.1 sidebar semantics as closely as the available data allows: Chats, In Work, Projects, project grouping, nested children, and archive handling. Make uncertainty visible rather than turning incomplete data into confident recovery advice.

The first view is a local, read-only dashboard. It uses node counts instead of SVG tree drawings and supports search, project/status filters, archive inclusion, and collapsing/expanding nested rows. It is for browsing and opening sessions—not operating them.

## Non-goals and anti-goals

- No recovery, restart, question answering/dismissal, or other session mutations in v1.
- No OpenChamber internals patch, custom sidebar section, SVG tree renderer, or claim of exact sidebar parity.
- Never infer that a historical failure means a session is currently dead; never mistake a question pause for a recovery candidate.
- No unverified `/dashboard` session links.

## Data and semantics

The existing input is the collapsible snapshot at `<workdir>/agent-tree-status-2026-11-10.json` (a path local to the machine that produced it), generated **2026-11-10T15:24:49.735Z**. It is a stale point-in-time snapshot, not live state. It contains session hierarchy (`parentId`, `depth`), project, node count, activity/status, raw outcome, color, question-pending heuristic, error class/evidence, and a dashboard URL. The existing seven-day outcome window and its counts are snapshot facts, not current totals.

The next design/implementation should define a canonical JSON contract and a read-only collector that regenerates it. Keep these independent dimensions distinct:

- **Status:** current operational state, such as in work, idle, or archived.
- **Activity:** latest observed activity/time.
- **Last outcome:** most recent terminal outcome and its evidence, whether success, failure, or interruption.
- **Question pending:** an explicit/estimated preservation pause, never a dead-session signal.

The `/api/question` request previously returned 401, so snapshot-derived pending-question classification is approximate; label its provenance/confidence. Do not answer or dismiss questions. Preserve parent/child nesting and avoid promoting children to independent top-level conversations. Archive inclusion must be explicit and default behavior must not silently mix archived records into active categories. Exact counts and categorization may remain incomplete until a supported host bridge exists.

## Layout and status presentation

**One sentence:** A searchable, filterable workspace with Chats, In Work, and project-grouped conversation trees, where each expandable row shows status, activity, last outcome, question/archive markers, and node count.

Use green for successful outcome, blue for currently in-progress, red for errored outcome, yellow for question-pending/preserve, and gray for idle or archived. Color must accompany text/icon labels; status, activity, and last outcome remain separately labeled. When multiple dimensions apply, show them together (for example, “In work” plus “Last outcome: failed”) rather than letting one color overwrite the others. Yellow preservation state takes precedence over restart-candidate styling.

## Interactions, links, and freshness

Read-only interactions: search; filter by project/status; optionally include archived sessions; expand/collapse project, parent, and child rows; open a session. No recovery action appears in v1. Any later recovery control requires a separate safety design that surfaces model, pending-question state, latest batch/exclusion context, and side-effect risk, then asks for explicit user confirmation.

OpenChamber 2.5.1 was browser-verified to use `/?session=<id>` as its canonical route. The requested `http://localhost:3000/dashboard?session=<id>` form is not verified and must not be emitted without a route check. Keep the base URL configurable and verify the route against the running target before generating links.

Show snapshot generation time and label the view as snapshot/stale when appropriate. Refresh means rerun the read-only collector and replace the JSON snapshot; it must never mutate OpenChamber data. Define a clear failure state that retains the last snapshot while showing its age and refresh error.

## Architecture options considered

| Option | Trade-off |
|---|---|
| **A. JSON + local standalone HTML now** | Fastest, but risks coupling the renderer to an ad hoc snapshot and makes a later extension migration harder. |
| **B. Native Extension Page now** | Fits OpenChamber’s extension surface, but the current SDK lists sessions by project and does not expose a global managed-Chats list or `metadata.openchamber.work` on `Session`; exact sidebar semantics are therefore unavailable without an unsupported bridge. |
| **C. JSON-first, local renderer now, extension later — recommended** | Define the read-only collector and canonical JSON contract as the stable boundary; render it in a local standalone HTML view now, then adapt that contract to an Extension Page if/when supported data access is available. This keeps the MVP useful without patching host internals. |

## Compatibility caveats and approval gate

OpenChamber 2.5.1 supports `contributes.page` (full-page extension) and `contributes.statusSection` (chat Work Status panel), but not a custom session-sidebar section. The SDK’s project-scoped listing is insufficient for global managed Chats and omits relevant work metadata. OpenChamber 2.6.1 source differs and is not an API contract; do not design against it as if it were supported. Use the local read-only snapshot/collector for MVP semantics and revisit an extension only against a verified supported API.

**Approval gate:** Jordan reviews and approves or corrects this design before any UI, collector, scaffolding, or other implementation work begins.

**This is design only; no UI implementation has been approved or performed.**
