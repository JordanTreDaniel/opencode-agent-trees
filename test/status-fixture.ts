// Synthetic `session_v2` fixture for the status projection tests.
//
// The projection reads the real OpenCode schema, so the fixture reproduces the
// exact columns it selects rather than a convenient mock. Tests then assert on
// real SQL behaviour (including the full-table child count that keeps isLeaf
// correct when the inventory is capped).
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import type { LiveState } from "../src/lib/status.ts"

export interface FixtureRow {
  id: string
  parent?: string | null
  project?: string | null
  fork?: string | null
  title?: string
  agent?: string
  model?: string | null
  outcome?: string | null
  created?: number
  updated?: number
  idle?: number | null
  archived?: number | null
  suspended?: number | null
  metadata?: Record<string, unknown> | null
}

const COLUMNS = [
  "id",
  "project_id",
  "parent_id",
  "fork_session_id",
  "title",
  "agent",
  "model",
  "idle_outcome",
  "time_created",
  "time_updated",
  "time_idle",
  "time_archived",
  "time_suspended",
  "metadata",
] as const

export interface FixtureDatabase {
  path: string
  cleanup(): void
}

export function writeSessionDb(rows: readonly FixtureRow[]): FixtureDatabase {
  const directory = mkdtempSync(join(tmpdir(), "tree-status-"))
  const path = join(directory, "opencode.db")
  const db = new DatabaseSync(path)
  try {
    db.exec(`
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        workspace_id TEXT,
        parent_id TEXT,
        fork_session_id TEXT,
        title TEXT,
        agent TEXT,
        model TEXT,
        idle_outcome TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        time_idle INTEGER,
        time_archived INTEGER,
        time_suspended INTEGER,
        metadata TEXT
      );
      CREATE INDEX session_v2_parent_idx ON session_v2 (parent_id);
    `)
    const insert = db.prepare(
      `INSERT INTO session_v2 (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`,
    )
    let clock = 1_700_000_000_000
    for (const row of rows) {
      clock += 1_000
      insert.run(
        row.id,
        row.project ?? "proj_fixture",
        row.parent ?? null,
        row.fork ?? null,
        row.title ?? row.id,
        row.agent ?? "general",
        row.model ?? JSON.stringify({ providerID: "test-provider", id: "test-model" }),
        row.outcome ?? null,
        row.created ?? clock,
        row.updated ?? clock,
        row.idle ?? null,
        row.archived ?? null,
        row.suspended ?? null,
        row.metadata === null || row.metadata === undefined ? null : JSON.stringify(row.metadata),
      )
    }
  } finally {
    db.close()
  }
  return {
    path,
    cleanup() {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

export function makeLive(input: {
  running?: readonly string[]
  hostStatus?: Record<string, string>
  pendingForms?: Record<string, number>
}): LiveState {
  return {
    running: new Set(input.running ?? []),
    hostStatus: new Map(Object.entries(input.hostStatus ?? {})),
    pendingForms: new Map(Object.entries(input.pendingForms ?? {})),
    serverTime: 1_700_000_999_999,
  }
}
