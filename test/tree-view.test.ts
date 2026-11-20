// Regression tests for scripts/tree-view.mjs.
//
// Two defects this guards:
//   1. The pending-row query was hardcoded to `session_pending`, which v2 renamed
//      to `session_inbox` with `data` renamed to `payload`. The tool died with
//      "no such table: session_pending" instead of printing a plan.
//   2. Restart planning ignored `time_archived`, so a fully archived tree still
//      reported restart leaves — the dirty-history case where a closed-out tree
//      looks like live work.
//
// The script reads the real OpenCode schema, so the fixture reproduces the exact
// columns it selects rather than a convenient mock.
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, describe, it } from "node:test"
import assert from "node:assert/strict"

const SCRIPT = new URL("../scripts/tree-view.mjs", import.meta.url).pathname
const OLD = 1_700_000_000_000 // far outside the 5-minute active window

interface Row {
  id: string
  parent?: string | null
  title: string
  outcome?: string | null
  archived?: number | null
}

const dirs: string[] = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function buildDb(rows: Row[], { pendingTable }: { pendingTable: "session_inbox" | "session_pending" }) {
  const dir = mkdtempSync(join(tmpdir(), "tree-view-"))
  dirs.push(dir)
  const path = join(dir, "opencode.db")
  const db = new DatabaseSync(path)

  db.exec(`CREATE TABLE session_v2 (
    id TEXT PRIMARY KEY, parent_id TEXT, title TEXT,
    time_created INTEGER, time_updated INTEGER, time_idle INTEGER,
    time_suspended INTEGER, time_archived INTEGER,
    idle_outcome TEXT, metadata TEXT
  )`)
  db.exec(`CREATE TABLE session_message (
    session_id TEXT, type TEXT, seq INTEGER, data TEXT
  )`)
  db.exec(pendingTable === "session_inbox"
    ? `CREATE TABLE session_inbox (
        id TEXT PRIMARY KEY, session_id TEXT, type TEXT, payload TEXT,
        delivery TEXT, enqueued_seq INTEGER, time_created INTEGER
      )`
    : `CREATE TABLE session_pending (
        session_id TEXT, type TEXT, data TEXT, delivery TEXT, time_created INTEGER
      )`)

  const insert = db.prepare(`INSERT INTO session_v2
    (id, parent_id, title, time_created, time_updated, time_idle,
     time_suspended, time_archived, idle_outcome, metadata)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, '{}')`)
  rows.forEach((row, index) => {
    insert.run(row.id, row.parent ?? null, row.title, OLD + index, OLD, OLD,
      row.archived ?? null, row.outcome ?? null)
  })
  db.close()
  return path
}

function run(dbPath: string, rootId: string) {
  return execFileSync(process.execPath, [SCRIPT, "--root", rootId, "--mode", "restart"], {
    encoding: "utf8",
    env: { ...process.env, OPENCODE_DB: dbPath, NODE_NO_WARNINGS: "1" },
  })
}

function runJson(dbPath: string, rootId: string) {
  return JSON.parse(execFileSync(process.execPath, [SCRIPT, "--root", rootId, "--mode", "json"], {
    encoding: "utf8",
    env: { ...process.env, OPENCODE_DB: dbPath, NODE_NO_WARNINGS: "1" },
  }))
}

const TREE: Row[] = [
  { id: "root", title: "root", outcome: "succeeded" },
  { id: "live-fail", parent: "root", title: "live failure", outcome: "failed" },
  { id: "closed-fail", parent: "root", title: "closed failure", outcome: "failed", archived: OLD },
]

describe("tree-view restart planning", () => {
  it("does not read the removed session_pending table", () => {
    const db = buildDb(TREE, { pendingTable: "session_inbox" })
    const out = run(db, "root")
    assert.match(out, /Restart leaves \(1\)/)
    assert.doesNotMatch(out, /no such table/)
  })

  it("still works when only the legacy session_pending table exists", () => {
    const db = buildDb(TREE, { pendingTable: "session_pending" })
    const out = run(db, "root")
    assert.match(out, /Restart leaves \(1\)/)
  })

  it("treats an archived failure as closed, not as a restart target", () => {
    const db = buildDb(TREE, { pendingTable: "session_inbox" })
    const result = runJson(db, "root")
    const ids = result.restartLeaves.map((leaf: { id: string }) => leaf.id)
    assert.deepEqual(ids, ["live-fail"], "archived failure must not be planned as a restart")
    assert.equal(result.counts.archived, 1)
    assert.equal(result.counts.failed, 1)
  })

  it("excludes archived and non-leaf failures from the recover call", () => {
    const db = buildDb(TREE, { pendingTable: "session_inbox" })
    const result = runJson(db, "root")
    assert.deepEqual(result.suggestedRecoverInput.excludeSessionIds, ["closed-fail"])
    assert.equal(result.suggestedRecoverInput.rootId, "root")
  })

  it("resumes no session at all when the whole tree is archived", () => {
    const rows: Row[] = TREE.map((row) => ({ ...row, archived: OLD }))
    const db = buildDb(rows, { pendingTable: "session_inbox" })
    const result = runJson(db, "root")
    assert.equal(result.restartLeaves.length, 0)
    assert.match(run(db, "root"), /nothing to restart/)
  })

  it("excludes failed ancestors so only leaves are resumed", () => {
    const rows: Row[] = [
      { id: "root", title: "root", outcome: "failed" },
      { id: "mid", parent: "root", title: "mid", outcome: "failed" },
      { id: "leaf", parent: "mid", title: "leaf", outcome: "failed" },
    ]
    const db = buildDb(rows, { pendingTable: "session_inbox" })
    const result = runJson(db, "root")
    assert.deepEqual(result.restartLeaves.map((leaf: { id: string }) => leaf.id), ["leaf"])
    assert.deepEqual(result.suggestedRecoverInput.excludeSessionIds, ["mid", "root"])
  })
})
