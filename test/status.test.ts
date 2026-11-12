import test from "node:test"
import assert from "node:assert/strict"

import { loadViewsDefinition, projectStatus, resolveView, type ProjectedSession } from "../src/lib/status.ts"
import { makeLive, writeSessionDb, type FixtureRow } from "./status-fixture.ts"

// A small but structurally varied tree:
//
//   ses_root
//     ├─ ses_a
//     │    └─ ses_a1
//     └─ ses_b
//   ses_loner        (root with no children)
//   ses_archived     (root, archived, failed)
//   ses_fork         (root, forked)
const TREE: FixtureRow[] = [
  { id: "ses_root", created: 100, updated: 900, outcome: "succeeded" },
  { id: "ses_a", parent: "ses_root", created: 200, updated: 800 },
  { id: "ses_a1", parent: "ses_a", created: 600, updated: 700, idle: 750, outcome: "succeeded" },
  { id: "ses_b", parent: "ses_root", created: 400, updated: 600, idle: 650, outcome: "failed" },
  { id: "ses_loner", created: 500, updated: 500 },
  { id: "ses_archived", created: 50, updated: 50, archived: 60, outcome: "failed" },
  { id: "ses_fork", created: 60, updated: 60, fork: "ses_root" },
]

function byId(sessions: readonly ProjectedSession[], id: string): ProjectedSession {
  const found = sessions.find((session) => session.id === id)
  assert.ok(found, `expected session ${id} in the projection`)
  return found
}

test("derived tree fields are correct on a synthetic tree", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    const projection = await projectStatus({ dbPath: fixture.path, host: false })
    const sessions = projection.sessions

    const root = byId(sessions, "ses_root")
    assert.equal(root.isRoot, true)
    assert.equal(root.hasParent, false)
    assert.equal(root.rootId, "ses_root")
    assert.equal(root.depth, 0)
    assert.equal(root.inTree, true, "a root with children is in a tree")
    assert.equal(root.isLeaf, false)
    assert.equal(root.childCount, 2)

    const a = byId(sessions, "ses_a")
    assert.equal(a.isRoot, false)
    assert.equal(a.hasParent, true)
    assert.equal(a.parentId, "ses_root")
    assert.equal(a.rootId, "ses_root")
    assert.equal(a.depth, 1)
    assert.equal(a.inTree, true)
    assert.equal(a.isLeaf, false)

    const a1 = byId(sessions, "ses_a1")
    assert.equal(a1.depth, 2)
    assert.equal(a1.rootId, "ses_root")
    assert.equal(a1.isLeaf, true, "the deepest session has no children")
    assert.equal(a1.childCount, 0)

    const loner = byId(sessions, "ses_loner")
    assert.equal(loner.isRoot, true)
    assert.equal(loner.inTree, false, "a childless root participates in no tree")
    assert.equal(loner.isLeaf, true)

    assert.equal(byId(sessions, "ses_fork").fork, true)
    assert.equal(byId(sessions, "ses_archived").archived, true)
    assert.equal(a1.lastActivity, 750, "lastActivity is max(updated, idle)")
    assert.equal(a.lastActivity, 800)
  } finally {
    fixture.cleanup()
  }
})

test("isSubtreeOf is self-inclusive and spans the whole subtree", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    const projection = await projectStatus({ dbPath: fixture.path, host: false, subtreeOf: "ses_a" })
    const membership = projection.views.subtree
    assert.equal(projection.meta.view, "subtree")
    assert.deepEqual([...membership.ids].sort(), ["ses_a", "ses_a1"], "the anchor includes itself and every descendant")
    assert.equal(membership.ids.includes("ses_b"), false, "a sibling subtree is excluded")
    assert.equal(membership.ids.includes("ses_root"), false, "the ancestor is excluded")

    const asViewName = await projectStatus({ dbPath: fixture.path, host: false, view: "subtree:ses_root" })
    assert.deepEqual(
      [...asViewName.views["subtree:ses_root"]!.ids].sort(),
      ["ses_a", "ses_a1", "ses_b", "ses_root"],
      "tree:<root> resolves to the same membership as subtree:<root>",
    )
  } finally {
    fixture.cleanup()
  }
})

test("question-paused requires a running turn AND a pending form", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    const live = makeLive({
      // ses_a is running and holds a form; ses_b holds a form but its turn is over.
      running: ["ses_a", "ses_a1"],
      hostStatus: { ses_a: "busy", ses_a1: "busy", ses_b: "idle", ses_root: "idle" },
      pendingForms: { ses_a: 1, ses_b: 2 },
    })
    const projection = await projectStatus({ dbPath: fixture.path, live })

    assert.deepEqual(projection.views["question-paused"]!.ids, ["ses_a"], "only running + form qualifies")

    const a = byId(projection.sessions, "ses_a")
    assert.equal(a.status, "running")
    assert.equal(a.hasPendingForm, true)
    assert.equal(a.paused, true)

    // Running with no form is not a pause.
    const a1 = byId(projection.sessions, "ses_a1")
    assert.equal(a1.status, "running")
    assert.equal(a1.hasPendingForm, false)
    assert.equal(a1.paused, false)

    // Form with no running turn is not a pause: the stale-form case.
    const b = byId(projection.sessions, "ses_b")
    assert.equal(b.hasPendingForm, true, "the form is still visible")
    assert.equal(b.status, "idle", "the host says the turn has ended")
    assert.equal(b.paused, false)
    assert.equal(projection.views["question-paused"]!.ids.includes("ses_b"), false)
    assert.equal(b.pendingFormCount, 2)
  } finally {
    fixture.cleanup()
  }
})

test("a form that outlived its turn never reads as paused", async () => {
  const fixture = writeSessionDb([
    // The documented stale-form case: a form is present, the turn succeeded, and
    // the session is not in the running set.
    { id: "ses_stale", created: 1, updated: 2, idle: 3, outcome: "succeeded" },
  ])
  try {
    const projection = await projectStatus({
      dbPath: fixture.path,
      live: makeLive({ running: [], hostStatus: { ses_stale: "idle" }, pendingForms: { ses_stale: 1 } }),
    })
    const stale = byId(projection.sessions, "ses_stale")
    assert.equal(stale.hasPendingForm, true)
    assert.equal(stale.status, "idle")
    assert.equal(stale.paused, false)
    assert.deepEqual(projection.views["question-paused"]!.ids, [])
  } finally {
    fixture.cleanup()
  }
})

test("DB-only degradation sets stale and reports pending forms as unknown, not absent", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    const projection = await projectStatus({ dbPath: fixture.path, host: false })
    assert.equal(projection.meta.stale, true)
    assert.equal(projection.meta.source, "sqlite")
    assert.match(projection.meta.warnings.join("\n"), /pending forms are unknown/i)
    assert.deepEqual(projection.views["question-paused"]!.ids, [], "no claim without the live source")
    for (const session of projection.sessions) assert.equal(session.hasPendingForm, false)

    // A host that fails mid-flight degrades the same way and says why.
    const unreachable = await projectStatus({
      dbPath: fixture.path,
      host: "http://127.0.0.1:1",
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED")
      },
    })
    assert.equal(unreachable.meta.stale, true)
    assert.match(unreachable.meta.warnings.join("\n"), /ECONNREFUSED/)

    // The database still answers: run state falls back to recorded evidence.
    assert.equal(byId(unreachable.sessions, "ses_a1").status, "idle", "a recorded idle time proves a finished turn")
    assert.equal(unreachable.views.running!.count, 0)
  } finally {
    fixture.cleanup()
  }
})

test("userSpawned and waveIndex are reported unavailable instead of guessed", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    const projection = await projectStatus({ dbPath: fixture.path, host: false })

    const unavailable = projection.meta.unavailable
    assert.equal(unavailable.userSpawned?.unavailable, true)
    assert.equal(unavailable.waveIndex?.unavailable, true)
    assert.match(unavailable.userSpawned!.reason, /no source exists/i)
    assert.match(unavailable.waveIndex!.reason, /no source exists/i)

    for (const session of projection.sessions) {
      assert.equal(Object.hasOwn(session, "userSpawned"), false, "no fabricated userSpawned field")
      assert.equal(Object.hasOwn(session, "waveIndex"), false, "no fabricated waveIndex field")
    }

    // The vocabulary is declarative, so an unavailable filter must fail loudly.
    const views = loadViewsDefinition()
    assert.equal(views.filters.userSpawned?.unavailable, true)

    const withoutView = structuredClone(views)
    withoutView.views.running = { filters: { userSpawned: true }, sort: { field: "lastActivity", direction: "desc" } }
    await assert.rejects(
      () => projectStatus({ dbPath: fixture.path, host: false, views: withoutView }),
      /userSpawned is unavailable/,
    )
  } finally {
    fixture.cleanup()
  }
})

test("a capped inventory still derives rootId and depth from the whole table", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    // Page size 1 with no cap exercises the paging loop and reads every row.
    const full = await projectStatus({ dbPath: fixture.path, host: false, all: true, pageSize: 1 })
    assert.equal(full.sessions.length, TREE.length)
    assert.equal(full.meta.truncated, false)

    // A cap of one row keeps ancestor resolution honest: the chain is read from
    // the database even though the parent rows are outside the page.
    const capped = await projectStatus({ dbPath: fixture.path, host: false, limit: 1 })
    assert.equal(capped.sessions.length, 1)
    assert.equal(capped.meta.truncated, true)
    const newest = capped.sessions[0]!
    assert.equal(newest.id, "ses_a1", "newest by time_created")
    assert.equal(newest.parentId, "ses_a")
    assert.equal(newest.rootId, "ses_root", "root resolved outside the page")
    assert.equal(newest.depth, 2, "depth resolved outside the page")
    assert.equal(newest.isLeaf, true)
  } finally {
    fixture.cleanup()
  }
})

test("needs-restart lists recorded failures that are not running, and never the archived or running", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    const projection = await projectStatus({
      dbPath: fixture.path,
      live: makeLive({ running: ["ses_a"], hostStatus: { ses_a: "busy", ses_b: "idle" } }),
    })
    const ids = projection.views["needs-restart"]!.ids
    assert.deepEqual(ids, ["ses_b"], "ses_b failed and is idle; ses_archived is archived; ses_a is running")
    assert.equal(ids.includes("ses_archived"), false)
    assert.equal(ids.includes("ses_a"), false)
  } finally {
    fixture.cleanup()
  }
})

test("needs-restart includes an orphaned claim and excludes a claimed session the host still lists", async () => {
  const fixture = writeSessionDb([
    // (a) recorded failure, no claim: the outcome arm.
    { id: "ses_failed", created: 1, updated: 10, idle: 11, outcome: "failed" },
    // (b) claimed but absent from the host's active set: the orphan arm. Its
    // outcome succeeded, so ONLY the orphan arm can surface it.
    { id: "ses_orphan", parent: "ses_root", created: 2, updated: 20, suspended: 21, outcome: "succeeded" },
    // (c) claimed AND listed as active by the host: not orphaned, and its
    // outcome succeeded, so it must not appear at all.
    { id: "ses_claimed_active", created: 3, updated: 30, suspended: 31, outcome: "succeeded" },
    { id: "ses_root", created: 0, updated: 0 },
  ])
  try {
    const projection = await projectStatus({
      dbPath: fixture.path,
      live: makeLive({
        running: ["ses_claimed_active"],
        hostStatus: { ses_failed: "idle", ses_orphan: "idle", ses_claimed_active: "busy" },
      }),
    })

    const ids = projection.views["needs-restart"]!.ids
    assert.deepEqual([...ids].sort(), ["ses_failed", "ses_orphan"], "(a) failed-idle and (b) claimed-but-inactive appear")
    assert.equal(ids.includes("ses_claimed_active"), false, "(c) a claimed session still active is not a restart candidate")
    assert.equal(projection.meta.stale, false, "the host was read, so orphan detection is current")

    assert.equal(byId(projection.sessions, "ses_orphan").orphaned, true)
    assert.equal(byId(projection.sessions, "ses_claimed_active").orphaned, false)
    assert.equal(byId(projection.sessions, "ses_failed").orphaned, false, "no claim is knowably not-orphaned")
  } finally {
    fixture.cleanup()
  }
})

test("host off: orphaned is unknown with a stale warning, not a silent false negative", async () => {
  const fixture = writeSessionDb([
    { id: "ses_failed", created: 1, updated: 10, idle: 11, outcome: "failed" },
    // Claimed with a succeeded outcome: only the orphan arm could list it, and
    // without the host that arm is unevaluable.
    { id: "ses_claimed", created: 2, updated: 20, suspended: 21, outcome: "succeeded" },
    // Claimed AND failed: the outcome arm still works from DB evidence alone.
    { id: "ses_claimed_failed", created: 3, updated: 30, suspended: 31, outcome: "failed" },
  ])
  try {
    const projection = await projectStatus({ dbPath: fixture.path, host: false })

    assert.equal(projection.meta.stale, true, "the host was not read")
    assert.match(projection.meta.warnings.join("\n"), /orphan detection unavailable/i)

    const claimed = byId(projection.sessions, "ses_claimed")
    assert.equal(claimed.orphaned, null, "unknown is reported as null, never false")

    // Not a false negative: recorded failures (claimed or not) still list, and
    // the view says why the orphan arm contributed nothing.
    assert.deepEqual([...projection.views["needs-restart"]!.ids].sort(), ["ses_claimed_failed", "ses_failed"])

    // An `orphaned: false` filter must not treat unknown as false either.
    const views = loadViewsDefinition()
    const custom = structuredClone(views)
    custom.views.running = { filters: { orphaned: false }, sort: { field: "lastActivity", direction: "desc" } }
    const notOrphan = await projectStatus({ dbPath: fixture.path, host: false, views: custom })
    assert.deepEqual(notOrphan.views.running!.ids, ["ses_failed"], "unclaimed rows are knowably not orphaned")
    assert.equal(notOrphan.views.running!.ids.includes("ses_claimed"), false, "unknown satisfies neither true nor false")
  } finally {
    fixture.cleanup()
  }
})

test("the default view is a documented proxy, not a user-spawned field", async () => {
  const fixture = writeSessionDb([
    ...TREE,
    { id: "ses_scheduled", created: 70, updated: 70, metadata: { openchamber: { kind: "scheduled" } } },
  ])
  try {
    const projection = await projectStatus({ dbPath: fixture.path, host: false })
    const definition = loadViewsDefinition()
    assert.equal(definition.views.default!.isProxy, true)
    assert.match(definition.views.default!.proxyNote!, /documented proxy/i)
    assert.equal(projection.views.default!.isProxy, true)

    const ids = projection.views.default!.ids
    assert.equal(ids.includes("ses_root"), true, "a plain root is in the default view")
    assert.equal(ids.includes("ses_fork"), false, "a fork root is excluded")
    assert.equal(ids.includes("ses_scheduled"), false, "a scheduled root is excluded")
    assert.equal(ids.includes("ses_a"), false, "children are excluded")
  } finally {
    fixture.cleanup()
  }
})

test("a claim with no live turn is visible, which is what core never resumes", async () => {
  const fixture = writeSessionDb([
    // time_suspended is set by SessionStore.claim. A claimed session whose turn
    // is no longer live is exactly the orphan case core's root-only boot
    // recovery never picks up.
    { id: "ses_orphan", parent: "ses_parent", created: 1, updated: 2, suspended: 3, outcome: "succeeded" },
    { id: "ses_parent", created: 0, updated: 0 },
  ])
  try {
    const projection = await projectStatus({
      dbPath: fixture.path,
      live: makeLive({ running: [], hostStatus: { ses_orphan: "idle", ses_parent: "idle" } }),
    })
    const orphan = byId(projection.sessions, "ses_orphan")
    assert.equal(orphan.claimed, true, "the claim marker is still on the row")
    assert.equal(orphan.status, "idle", "no live turn")
    assert.equal(orphan.isRoot, false, "core's boot recovery only lists roots, so this child is never auto-resumed")

    const views = loadViewsDefinition()
    assert.ok(views.filters.claimed, "claimed is declared in the vocabulary")
    const custom = structuredClone(views)
    custom.views.running = { filters: { claimed: true, status: "idle" }, sort: { field: "lastActivity", direction: "desc" } }
    const found = await projectStatus({ dbPath: fixture.path, views: custom, live: makeLive({ hostStatus: { ses_orphan: "idle", ses_parent: "idle" } }) })
    assert.deepEqual(found.views.running!.ids, ["ses_orphan"])
  } finally {
    fixture.cleanup()
  }
})

test("every declared filter is actually implemented", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    const views = loadViewsDefinition()
    const samples: Record<string, unknown> = {
      parentId: "ses_root",
      rootId: "ses_root",
      project: "proj_fixture",
      status: "running",
      outcome: "failed",
      depth: 1,
      lastActivity: 0,
    }
    const declared = Object.entries(views.filters).filter(([, definition]) => !definition.unavailable)
    assert.ok(declared.length >= 15, "the vocabulary is declared")
    for (const [name] of declared) {
      const custom = structuredClone(views)
      const value = Object.hasOwn(samples, name) ? samples[name] : true
      custom.views.running = { filters: { [name]: value }, sort: { field: "lastActivity", direction: "desc" } }
      const projection = await projectStatus({ dbPath: fixture.path, host: false, views: custom })
      assert.ok(projection.views.running, `filter ${name} produced a view`)
    }
  } finally {
    fixture.cleanup()
  }
})

test("running and question-paused are disjoint and partition every status = running row", async () => {
  const fixture = writeSessionDb(TREE)
  try {
    // Exactly the shape the requirement targets: running sessions, one of which
    // is blocked on a question.
    const live = makeLive({
      running: ["ses_root", "ses_a", "ses_a1"],
      hostStatus: { ses_root: "busy", ses_a: "busy", ses_a1: "busy", ses_b: "idle" },
      pendingForms: { ses_a: 1 },
    })
    const projection = await projectStatus({ dbPath: fixture.path, live })

    // The definitions themselves, straight from the SSOT both the CLI and the
    // extension panel import.
    const definition = loadViewsDefinition()
    assert.deepEqual(definition.views.running!.filters, { status: "running", hasPendingForm: false })
    assert.deepEqual(definition.views["question-paused"]!.filters, { status: "running", hasPendingForm: true })

    const allRunning = projection.sessions
      .filter((session) => session.status === "running")
      .map((session) => session.id)
      .sort()
    assert.deepEqual(allRunning, ["ses_a", "ses_a1", "ses_root"])

    const running = projection.views.running!
    const paused = projection.views["question-paused"]!
    assert.deepEqual([...running.ids].sort(), ["ses_a1", "ses_root"], "the session blocked on a question is not actively running")
    assert.deepEqual([...paused.ids], ["ses_a"])

    const overlap = running.ids.filter((id) => paused.ids.includes(id))
    assert.deepEqual(overlap, [], "running and question-paused share no session")
    assert.equal(
      running.count + paused.count,
      allRunning.length,
      "sum of the two counts == count of all status = running rows",
    )
    const union = [...new Set([...running.ids, ...paused.ids])].sort()
    assert.deepEqual(union, allRunning, "every running row is in exactly one of the two views")
  } finally {
    fixture.cleanup()
  }
})

test("view names resolve without the engine inventing a filter set", () => {
  const views = loadViewsDefinition()
  assert.deepEqual(Object.keys(views.views).sort(), [
    "default",
    "needs-restart",
    "question-paused",
    "running",
    "subtree",
    "tree",
  ])

  const tree = resolveView(views, "tree:ses_x")
  assert.deepEqual(tree.filters, { rootId: "ses_x" })
  const subtree = resolveView(views, "subtree:ses_y")
  assert.deepEqual(subtree.filters, { isSubtreeOf: "ses_y" })

  const skipped = resolveView(views, "tree")
  assert.match(skipped.skipped!, /--root/)

  assert.throws(() => resolveView(views, "no-such-view"), /unknown view/)
})
