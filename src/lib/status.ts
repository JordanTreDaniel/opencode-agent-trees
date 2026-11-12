// Status/views projection over OpenCode sessions.
//
// Two sources are merged:
//   inventory — `session_v2` in the OpenCode SQLite database, paged newest-first
//               and capped (default 2000, `--all` ignores the cap).
//   live      — the host's `/api/session/active` (running ids) and
//               `/api/sessions/status` (per-session status + pending forms).
//               The host is the only cross-project source of pending forms;
//               `/api/form` is directory-scoped and is deliberately not used.
//
// The live source is optional. Without it every status/forms field degrades to
// DB-only and the projection says so with `stale: true` plus an explicit
// warning — absence of evidence is never reported as evidence of absence.
//
// The filter vocabulary and the six named views are NOT defined here. They live
// in `views.json` so the CLI, the projection and the docs cannot drift apart.

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Declarative definition
// ---------------------------------------------------------------------------

export interface FilterDefinition {
  type?: string
  derived?: string
  description?: string
  reason?: string
  note?: string
  /** Present and true when no source exists for the filter. */
  unavailable?: boolean
}

export interface SortDefinition {
  field: string
  direction: "asc" | "desc"
}

export interface ViewDefinition {
  filters: Record<string, unknown>
  sort: SortDefinition
  isProxy?: boolean
  proxyNote?: string
  note?: string
  parameters?: string[]
}

export interface ViewsDefinition {
  version: number
  sources?: Record<string, string>
  /** Engine-interpreted operators available inside a view's filter set. */
  operators?: Record<string, string>
  sort: { default: SortDefinition; tiebreak: SortDefinition; fields?: Record<string, string> }
  filters: Record<string, FilterDefinition>
  views: Record<string, ViewDefinition>
}

const VIEWS_PATH = fileURLToPath(new URL("./views.json", import.meta.url))

let cachedViews: ViewsDefinition | null = null

/** Load (and memoise) the single declarative definition. */
export function loadViewsDefinition(path: string = VIEWS_PATH): ViewsDefinition {
  if (!path || path === VIEWS_PATH) {
    if (cachedViews) return cachedViews
    cachedViews = JSON.parse(readFileSync(VIEWS_PATH, "utf8")) as ViewsDefinition
    return cachedViews
  }
  return JSON.parse(readFileSync(path, "utf8")) as ViewsDefinition
}

/** Filters with no data source, in the shape the projection reports them. */
export function unavailableFilters(views: ViewsDefinition): Record<string, { unavailable: true; reason: string }> {
  const out: Record<string, { unavailable: true; reason: string }> = {}
  for (const [name, definition] of Object.entries(views.filters)) {
    if (definition.unavailable) out[name] = { unavailable: true, reason: definition.reason ?? "no source" }
  }
  return out
}

/** Does any named view filter on `name`, at the top level or inside a `$any` group? */
function viewUsesFilter(views: ViewsDefinition, name: string): boolean {
  const references = (filters: Record<string, unknown>): boolean =>
    Object.entries(filters).some(([key, value]) => {
      if (key === name) return true
      if (key === "$any" && Array.isArray(value)) {
        return value.some(
          (group) => !!group && typeof group === "object" && !Array.isArray(group) && references(group as Record<string, unknown>),
        )
      }
      return false
    })
  return Object.values(views.views).some((definition) => references(definition.filters))
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function defaultDbPath(): string {
  if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB
  // OpenCode follows the XDG data dir when it is set; only fall back to the
  // tilde path when it is not. The two paths are different instances.
  const xdg = process.env.XDG_DATA_HOME
  if (xdg) return join(xdg, "opencode/opencode.db")
  return join(homedir(), ".local/share/opencode/opencode.db")
}

export const DEFAULT_HOST = "http://localhost:3000"
export const DEFAULT_INVENTORY_LIMIT = 2000
export const DEFAULT_PAGE_SIZE = 500
export const DEFAULT_TIMEOUT_MS = 2000
const MAX_CHAIN = 256
const MAX_ANCESTOR_LOOKUPS = 20000

/** The host writes one runfile per port; it is the only place a UI password lives. */
export function runfilePathForPort(port: number | string): string {
  return join(homedir(), ".config/openchamber/run", `openchamber-${port}.json`)
}

// ---------------------------------------------------------------------------
// SQLite access (node:sqlite, dynamically loaded so a missing module degrades)
// ---------------------------------------------------------------------------

interface SqliteStatement {
  all(...params: unknown[]): Array<Record<string, unknown>>
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  close(): void
}
type DatabaseCtor = new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase

let databaseCtor: DatabaseCtor | null | undefined

async function getDatabaseCtor(): Promise<DatabaseCtor | null> {
  if (databaseCtor !== undefined) return databaseCtor
  try {
    // A variable specifier keeps the import resolvable at runtime but invisible
    // to static type resolution, so an older @types/node cannot break the build.
    const specifier: string = "node:sqlite"
    const module = (await import(specifier)) as { DatabaseSync: DatabaseCtor }
    databaseCtor = module.DatabaseSync
  } catch {
    databaseCtor = null
  }
  return databaseCtor
}

function parseJsonColumn(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.trim().length === 0) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function modelLabel(value: unknown): string | null {
  const parsed = typeof value === "string" ? (() => {
    try { return JSON.parse(value) as unknown } catch { return value }
  })() : value
  if (parsed === null || parsed === undefined) return null
  if (typeof parsed === "string") return parsed.length ? parsed : null
  if (typeof parsed !== "object") return String(parsed)
  const model = parsed as { id?: unknown; modelID?: unknown; providerID?: unknown }
  const id = typeof model.id === "string" ? model.id : typeof model.modelID === "string" ? model.modelID : null
  const provider = typeof model.providerID === "string" ? model.providerID : null
  if (provider && id) return `${provider}/${id}`
  return id ?? provider ?? null
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string" && value.trim().length && Number.isFinite(Number(value))) return Number(value)
  return null
}

function toText(value: unknown): string | null {
  if (typeof value === "string") return value.length ? value : null
  if (value === null || value === undefined) return null
  return String(value)
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string
  parentId: string | null
  projectId: string | null
  forkSessionId: string | null
  title: string | null
  agent: string | null
  model: string | null
  outcome: string | null
  timeCreated: number | null
  timeUpdated: number | null
  timeIdle: number | null
  timeArchived: number | null
  timeSuspended: number | null
  metadata: Record<string, unknown> | null
}

type ParentLookup = (id: string) => Promise<string | null> | string | null

export interface Inventory {
  rows: SessionRow[]
  /**
   * parent_id -> number of children, computed over the whole table so `isLeaf`
   * stays correct when the inventory page is capped.
   */
  childCounts: Map<string, number>
  /** Rows available to page through, when known. */
  total: number | null
  scanned: number
  truncated: boolean
  source: "sqlite" | "host"
}

function rowFromSqlite(record: Record<string, unknown>): SessionRow {
  return {
    id: String(record.id),
    parentId: toText(record.parent_id),
    projectId: toText(record.project_id),
    forkSessionId: toText(record.fork_session_id),
    title: toText(record.title),
    agent: toText(record.agent),
    model: modelLabel(record.model),
    outcome: toText(record.idle_outcome),
    timeCreated: toNumber(record.time_created),
    timeUpdated: toNumber(record.time_updated),
    timeIdle: toNumber(record.time_idle),
    timeArchived: toNumber(record.time_archived),
    timeSuspended: toNumber(record.time_suspended),
    metadata: parseJsonColumn(record.metadata),
  }
}

function rowFromHost(record: Record<string, unknown>): SessionRow | null {
  if (typeof record.id !== "string" || !record.id.length) return null
  const time = (record.time ?? {}) as { created?: unknown; updated?: unknown; idle?: unknown }
  // Optional fields are omitted when unset, so a missing key is null, not "unknown".
  return {
    id: record.id,
    parentId: toText(record.parentID),
    projectId: toText(record.projectID),
    forkSessionId: toText(record.forkSessionID),
    title: toText(record.title),
    agent: toText(record.agent),
    model: modelLabel(record.model),
    outcome: toText(record.outcome),
    timeCreated: toNumber(time.created),
    timeUpdated: toNumber(time.updated),
    timeIdle: toNumber(time.idle),
    timeArchived: toNumber(record.timeArchived),
    timeSuspended: toNumber(record.timeSuspended),
    metadata: record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : null,
  }
}

interface OpenedInventory {
  inventory: Inventory
  lookupParent: ParentLookup
  close(): void
}

async function openSqliteInventory(
  dbPath: string,
  options: { limit: number | null; pageSize: number },
): Promise<OpenedInventory> {
  const Ctor = await getDatabaseCtor()
  if (!Ctor) throw new Error("node:sqlite is unavailable in this Node runtime (Node 22+ required)")

  const db = new Ctor(dbPath, { readOnly: true })
  try {
    const paginate = db.prepare(
      `SELECT id, parent_id, project_id, fork_session_id, title, agent, model, idle_outcome,
              time_created, time_updated, time_idle, time_archived, time_suspended, metadata
         FROM session_v2
        ORDER BY time_created DESC, id DESC
        LIMIT ? OFFSET ?`,
    )
    const pageSize = Math.max(1, options.pageSize)
    const rows: SessionRow[] = []
    let offset = 0
    let exhausted = false
    // Page until exhausted or the cap is reached; the cap is a hard stop, never a silent drop.
    while (!exhausted) {
      const want = options.limit === null ? pageSize : Math.min(pageSize, options.limit - rows.length)
      if (want <= 0) break
      const page = paginate.all(want, offset)
      for (const record of page) rows.push(rowFromSqlite(record))
      offset += page.length
      if (page.length < want) exhausted = true
    }

    const childCounts = new Map<string, number>()
    for (const record of db
      .prepare("SELECT parent_id, COUNT(*) AS children FROM session_v2 WHERE parent_id IS NOT NULL GROUP BY parent_id")
      .all()) {
      const parentId = toText(record.parent_id)
      if (parentId) childCounts.set(parentId, toNumber(record.children) ?? 0)
    }
    const total = toNumber((db.prepare("SELECT COUNT(*) AS total FROM session_v2").all()[0] ?? {}).total)

    const lookup = db.prepare("SELECT parent_id FROM session_v2 WHERE id = ?")
    const lookupParent: ParentLookup = (id) => {
      const [record] = lookup.all(id)
      return record ? toText(record.parent_id) : null
    }

    return {
      inventory: {
        rows,
        childCounts,
        total,
        scanned: rows.length,
        truncated: options.limit !== null && total !== null && total > rows.length,
        source: "sqlite",
      },
      lookupParent,
      close: () => db.close(),
    }
  } catch (error) {
    db.close()
    throw error
  }
}

// ---------------------------------------------------------------------------
// Single-row lookup
// ---------------------------------------------------------------------------

/**
 * Read one session row straight from the session database.
 *
 * Used by pause verification: the execution claim (`time_suspended`) is a
 * database fact, so a caller that must prove a turn is actually held reads it
 * here instead of inferring it from the host's status string. Returns `null`
 * when the row does not exist; throws when the database or `node:sqlite` is
 * unreadable, so "unknown" never collapses into "no claim".
 */
export async function readSessionRow(dbPath: string, id: string): Promise<SessionRow | null> {
  const Ctor = await getDatabaseCtor()
  if (!Ctor) throw new Error("node:sqlite is unavailable in this Node runtime (Node 22+ required)")
  const db = new Ctor(dbPath, { readOnly: true })
  try {
    const [record] = db
      .prepare(
        `SELECT id, parent_id, project_id, fork_session_id, title, agent, model, idle_outcome,
                time_created, time_updated, time_idle, time_archived, time_suspended, metadata
           FROM session_v2 WHERE id = ?`,
      )
      .all(id)
    return record ? rowFromSqlite(record) : null
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Live state from the host
// ---------------------------------------------------------------------------

export interface LiveState {
  running: Set<string>
  hostStatus: Map<string, string>
  /** sessionID -> number of pending forms. */
  pendingForms: Map<string, number>
  serverTime: number | null
}

export interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
  headers?: { get(name: string): string | null; getSetCookie?(): string[] }
}
export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<FetchResponseLike>

export interface LiveOptions {
  host?: string
  cookie?: string
  password?: string
  port?: number
  runfilePath?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}

function isLoopback(host: string): boolean {
  try {
    const url = new URL(host)
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  } catch {
    return false
  }
}

function readRunfileCredentials(path: string): { password?: string; cookie?: string } {
  // Values are read in-process and never printed, logged, or placed in argv.
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { uiPassword?: unknown; cookie?: unknown }
    const password = typeof parsed.uiPassword === "string" && parsed.uiPassword.length ? parsed.uiPassword : undefined
    const cookie = typeof parsed.cookie === "string" && parsed.cookie.length ? parsed.cookie : undefined
    return { ...(password ? { password } : {}), ...(cookie ? { cookie } : {}) }
  } catch {
    return {}
  }
}

function cookieHeaderFrom(response: FetchResponseLike): string | null {
  const headers = response.headers
  if (!headers) return null
  const many = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : []
  if (many.length) return many.map((value) => value.split(";")[0]!).filter(Boolean).join("; ")
  const single = headers.get("set-cookie")
  return single ? single.split(";")[0]! : null
}

/** An HTTP failure from the host, carrying the path and status for callers that must branch on them. */
export class HostRequestError extends Error {
  readonly path: string
  readonly status: number
  constructor(path: string, status: number) {
    super(`${path} returned HTTP ${status}`)
    this.name = "HostRequestError"
    this.path = path
    this.status = status
  }
}

export interface HostClient {
  host: string
  get<T = unknown>(path: string): Promise<T>
  /** POST JSON; a 2xx with an empty body resolves to `undefined` (the form reply endpoint returns 204). */
  post<T = unknown>(path: string, body: unknown): Promise<T>
}

/**
 * Authenticated client for the host's HTTP API.
 *
 * Auth is resolved in this order: explicit cookie, explicit password, runfile
 * for the host's port. The runfile password is sent only to a loopback host and
 * is never placed in argv or in any message this module returns.
 */
export async function createHostClient(options: LiveOptions = {}): Promise<HostClient> {
  const host = (options.host ?? process.env.OPENCHAMBER_HOST ?? DEFAULT_HOST).replace(/\/+$/, "")
  const fetchImpl = (options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike))
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable")
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const signal = (): AbortSignal | undefined =>
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined

  let cookie = options.cookie
  if (!cookie) {
    const port = options.port ?? Number(new URL(host).port || 3000)
    const runfile = options.runfilePath ?? runfilePathForPort(port)
    const credentials = readRunfileCredentials(runfile)
    cookie = credentials.cookie
    const password = options.password ?? credentials.password
    if (!cookie && password) {
      if (!isLoopback(host)) {
        throw new Error(`refusing to send the local UI password to non-loopback host ${host}`)
      }
      const login = await fetchImpl(`${host}/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
        ...(timeoutMs ? { signal: signal() } : {}),
      })
      if (!login.ok) throw new Error(`host login failed with HTTP ${login.status}`)
      cookie = cookieHeaderFrom(login) ?? undefined
      if (!cookie) throw new Error("host login returned no session cookie")
    }
  }

  const request = async <T>(path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<T> => {
    const response = await fetchImpl(`${host}${path}`, {
      ...(init?.method ? { method: init.method } : {}),
      headers: { ...(cookie ? { cookie } : {}), ...(init?.headers ?? {}) },
      ...(init?.body !== undefined ? { body: init.body } : {}),
      ...(timeoutMs ? { signal: signal() } : {}),
    })
    if (!response.ok) throw new HostRequestError(path, response.status)
    try {
      return (await response.json()) as T
    } catch {
      // 2xx with no JSON body (e.g. the form reply endpoint's 204).
      return undefined as T
    }
  }

  return {
    host,
    get: (path) => request(path),
    post: (path, body) =>
      request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  }
}

/**
 * Read the running set and the pending-form set from the host.
 *
 * Auth is resolved by {@link createHostClient}: explicit cookie, explicit
 * password, then the runfile for the host's port.
 */
export async function loadLiveState(options: LiveOptions = {}): Promise<LiveState> {
  const client = await createHostClient(options)
  const get = <T>(path: string): Promise<T> => client.get<T>(path)

  const active = (await get("/api/session/active")) as { data?: Record<string, { type?: string }> }
  const status = (await get("/api/sessions/status")) as {
    sessions?: Record<string, { status?: string }>
    pending?: Record<string, { forms?: unknown[] }>
    serverTime?: number
  }

  const running = new Set<string>()
  for (const [sessionID, entry] of Object.entries(active?.data ?? {})) {
    if (!entry || typeof entry !== "object") continue
    if (entry.type === undefined || entry.type === "running") running.add(sessionID)
  }

  const hostStatus = new Map<string, string>()
  for (const [sessionID, entry] of Object.entries(status?.sessions ?? {})) {
    if (entry && typeof entry.status === "string") hostStatus.set(sessionID, entry.status)
  }

  const pendingForms = new Map<string, number>()
  for (const [sessionID, entry] of Object.entries(status?.pending ?? {})) {
    const forms = Array.isArray(entry?.forms) ? entry.forms.length : 0
    if (forms > 0) pendingForms.set(sessionID, forms)
  }

  return { running, hostStatus, pendingForms, serverTime: toNumber(status?.serverTime) }
}

// ---------------------------------------------------------------------------
// Derived graph
// ---------------------------------------------------------------------------

export type SessionStatus = "running" | "idle" | "unknown"

export interface ProjectedSession extends SessionRow {
  rootId: string
  depth: number
  childCount: number
  isRoot: boolean
  hasParent: boolean
  inTree: boolean
  isLeaf: boolean
  status: SessionStatus
  archived: boolean
  /**
   * Holds an execution claim. `time_suspended` is set by SessionStore.claim when
   * a turn starts, which is why a paused session still reports it.
   */
  claimed: boolean
  /**
   * `orphaned = claimed ∧ ¬running` — the row holds an execution claim but the
   * host's active set (`GET /api/session/active`) does not list it. That is an
   * orphaned claim: core never auto-resumes it, so `needs-restart` must surface
   * it. Tri-state on purpose:
   *   - `true`  claimed and absent from the active set (host was read);
   *   - `false` no claim (a DB-only fact), or the host lists the session;
   *   - `null`  claimed but the host was not read, so `running` is unknown.
   * Unknown is never collapsed to `false`; the projection warns instead.
   */
  orphaned: boolean | null
  fork: boolean
  scheduled: boolean
  hasPendingForm: boolean
  pendingFormCount: number
  /** Convenience flag: running AND holds a pending form. Both are required. */
  paused: boolean
  lastActivity: number | null
}

interface Graph {
  chainOf(id: string): string[]
  childCountOf(id: string): number
}

async function buildGraph(inventory: Inventory, lookupParent: ParentLookup): Promise<{ graph: Graph; ancestorLookups: number }> {
  const chains = new Map<string, string[]>()
  const rowsById = new Map(inventory.rows.map((row) => [row.id, row]))
  let ancestorLookups = 0

  const resolveParent = async (id: string): Promise<string | null> => {
    const known = rowsById.get(id)
    if (known) return known.parentId
    if (ancestorLookups >= MAX_ANCESTOR_LOOKUPS) return null
    ancestorLookups += 1
    return await lookupParent(id)
  }

  const directParent = new Map<string, string | null>()
  for (const row of inventory.rows) directParent.set(row.id, row.parentId)

  const chainOf = (id: string): string[] => {
    const cached = chains.get(id)
    if (cached) return cached
    const chain: string[] = [id]
    const seen = new Set<string>([id])
    let cursor = directParent.get(id) ?? null
    while (cursor && !seen.has(cursor) && chain.length < MAX_CHAIN) {
      chain.push(cursor)
      seen.add(cursor)
      cursor = directParent.get(cursor) ?? null
    }
    chains.set(id, chain)
    return chain
  }

  // Only rows outside the capped page need a database round-trip for ancestors.
  const missing = inventory.rows.filter((row) => row.parentId && !directParent.has(row.parentId))
  for (const row of missing) {
    let cursor = row.parentId
    const seen = new Set<string>([row.id])
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const parent = await resolveParent(cursor)
      directParent.set(cursor, parent)
      cursor = parent
    }
  }

  for (const row of inventory.rows) chainOf(row.id)

  const childCounts = new Map<string, number>()
  for (const [parentId, children] of inventory.childCounts) childCounts.set(parentId, children)

  return {
    graph: {
      chainOf,
      childCountOf: (id) => childCounts.get(id) ?? 0,
    },
    ancestorLookups,
  }
}

function normalizeStatus(raw: string | undefined): SessionStatus | null {
  if (!raw) return null
  const value = raw.toLowerCase()
  if (value === "running" || value === "busy" || value === "working" || value === "active") return "running"
  if (value === "idle" || value === "done" || value === "finished") return "idle"
  return null
}

function projectSession(row: SessionRow, graph: Graph, live: LiveState | null): ProjectedSession {
  const chain = graph.chainOf(row.id)
  const childCount = graph.childCountOf(row.id)
  const archived = row.timeArchived !== null
  const pendingFormCount = live?.pendingForms.get(row.id) ?? 0

  let status: SessionStatus = "unknown"
  if (live) {
    if (live.running.has(row.id)) status = "running"
    else status = normalizeStatus(live.hostStatus.get(row.id)) ?? "unknown"
  }
  // DB-only evidence: a session that recorded an idle time or an outcome has
  // completed at least one turn. A running session cannot be inferred from the
  // database, so "unknown" stays honest instead of guessing "idle".
  if (status === "unknown" && (row.timeIdle !== null || row.outcome !== null)) status = "idle"

  const kind = ((row.metadata?.openchamber ?? {}) as { kind?: unknown }).kind
  const lastActivity = Math.max(row.timeUpdated ?? 0, row.timeIdle ?? 0) || null
  const claimed = row.timeSuspended !== null
  // orphaned = claimed ∧ ¬running. Without the live source `running` is
  // unknown, so a claimed row reports null (unknown) — never false.
  const orphaned = !claimed ? false : live ? !live.running.has(row.id) : null

  return {
    ...row,
    rootId: chain[chain.length - 1] ?? row.id,
    depth: Math.max(0, chain.length - 1),
    childCount,
    isRoot: row.parentId === null,
    hasParent: row.parentId !== null,
    inTree: row.parentId !== null || childCount > 0,
    isLeaf: childCount === 0,
    status,
    archived,
    claimed,
    orphaned,
    fork: row.forkSessionId !== null,
    scheduled: kind === "scheduled",
    hasPendingForm: pendingFormCount > 0,
    pendingFormCount,
    paused: status === "running" && pendingFormCount > 0,
    lastActivity,
  }
}

// ---------------------------------------------------------------------------
// Filter evaluation
// ---------------------------------------------------------------------------

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [String(value)]
}

function epoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function matchesDepth(actual: number, expected: unknown): boolean {
  if (typeof expected === "number") return actual === expected
  if (expected && typeof expected === "object") {
    const bounds = expected as { min?: unknown; max?: unknown }
    if (typeof bounds.min === "number" && actual < bounds.min) return false
    if (typeof bounds.max === "number" && actual > bounds.max) return false
    return true
  }
  return true
}

function matchesOutcome(session: ProjectedSession, expected: unknown): boolean {
  const wanted = asArray(expected).map((value) => value.toLowerCase())
  return wanted.includes((session.outcome ?? "none").toLowerCase())
}

function matchesLastActivity(session: ProjectedSession, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    const range = expected as { after?: unknown; before?: unknown }
    const after = range.after === undefined ? null : epoch(range.after)
    const before = range.before === undefined ? null : epoch(range.before)
    if (after !== null && (session.lastActivity === null || session.lastActivity < after)) return false
    if (before !== null && (session.lastActivity === null || session.lastActivity >= before)) return false
    return true
  }
  const since = epoch(expected)
  if (since === null) return true
  return session.lastActivity !== null && session.lastActivity >= since
}

interface FilterContext {
  views: ViewsDefinition
  rootId?: string | undefined
  subtreeOf?: string | undefined
  chainOf(id: string): string[]
}

function matches(session: ProjectedSession, filters: Record<string, unknown>, context: FilterContext): boolean {
  for (const [name, expected] of Object.entries(filters)) {
    if (name === "$any") {
      // Disjunction: the session matches when ANY sub-filter set matches. The
      // named views stay declarative in views.json; nothing is hardcoded here.
      if (!Array.isArray(expected) || expected.length === 0) throw new Error("$any expects a non-empty array of filter sets")
      const matchesAny = expected.some((group) => {
        if (!group || typeof group !== "object" || Array.isArray(group)) throw new Error("$any expects an array of filter sets")
        return matches(session, group as Record<string, unknown>, context)
      })
      if (!matchesAny) return false
      continue
    }
    const definition = context.views.filters[name]
    if (!definition) throw new Error(`unknown filter: ${name}`)
    if (definition.unavailable) {
      throw new Error(`filter ${name} is unavailable: ${definition.reason ?? "no source"}`)
    }
    switch (name) {
      case "isRoot":
        if (session.isRoot !== Boolean(expected)) return false
        break
      case "hasParent":
        if (session.hasParent !== Boolean(expected)) return false
        break
      case "parentId":
        if (session.parentId !== String(expected)) return false
        break
      case "rootId":
        if (session.rootId !== String(expected)) return false
        break
      case "depth":
        if (!matchesDepth(session.depth, expected)) return false
        break
      case "inTree":
        if (session.inTree !== Boolean(expected)) return false
        break
      case "isSubtreeOf": {
        // Self-inclusive: a session belongs to its own subtree.
        if (!context.chainOf(session.id).includes(String(expected))) return false
        break
      }
      case "isLeaf":
        if (session.isLeaf !== Boolean(expected)) return false
        break
      case "status": {
        const wanted = asArray(expected)
        if (!wanted.includes(session.status)) return false
        break
      }
      case "hasPendingForm":
        if (session.hasPendingForm !== Boolean(expected)) return false
        break
      case "archived":
        if (session.archived !== Boolean(expected)) return false
        break
      case "claimed":
        if (session.claimed !== Boolean(expected)) return false
        break
      case "orphaned":
        // Tri-state: `null` (host not read) satisfies neither true nor false,
        // so an unknown orphan can never be reported as a non-orphan — and
        // never as one either: the projection warns when this arm is unevaluable.
        if (session.orphaned !== Boolean(expected)) return false
        break
      case "project":
        if (session.projectId !== String(expected)) return false
        break
      case "lastActivity":
        if (!matchesLastActivity(session, expected)) return false
        break
      case "outcome":
        if (!matchesOutcome(session, expected)) return false
        break
      case "fork":
        if (session.fork !== Boolean(expected)) return false
        break
      case "scheduled":
        if (session.scheduled !== Boolean(expected)) return false
        break
      default:
        throw new Error(`filter ${name} is declared but not implemented`)
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * Resolve a view name to its filter set.
 *
 * `tree:<id>` and `subtree:<id>` are accepted as one-token forms so the CLI can
 * take a view name without a second flag; `--root` / `--subtree` do the same.
 */
export function resolveView(
  views: ViewsDefinition,
  name: string,
  parameters: { rootId?: string | undefined; subtreeOf?: string | undefined } = {},
): { name: string; filters: Record<string, unknown>; sort: SortDefinition; skipped?: string } {
  const trimmed = name.trim()

  if (trimmed.startsWith("tree:")) {
    const anchor = trimmed.slice("tree:".length).trim()
    if (!anchor) throw new Error("view tree:<rootId> requires an id")
    return { name: `tree:${anchor}`, filters: { rootId: anchor }, sort: views.views.tree?.sort ?? views.sort.default }
  }
  if (trimmed.startsWith("subtree:")) {
    const anchor = trimmed.slice("subtree:".length).trim()
    if (!anchor) throw new Error("view subtree:<id> requires an id")
    return { name: `subtree:${anchor}`, filters: { isSubtreeOf: anchor }, sort: views.views.subtree?.sort ?? views.sort.default }
  }

  const definition = views.views[trimmed]
  if (!definition) {
    throw new Error(`unknown view: ${trimmed} (known: ${Object.keys(views.views).join(", ")})`)
  }

  const filters: Record<string, unknown> = {}
  for (const [filter, value] of Object.entries(definition.filters)) {
    if (value === "$root") {
      if (!parameters.rootId) return { name: trimmed, filters: {}, sort: definition.sort, skipped: "view requires --root <sessionID>" }
      filters[filter] = parameters.rootId
    } else if (value === "$subtree") {
      if (!parameters.subtreeOf) return { name: trimmed, filters: {}, sort: definition.sort, skipped: "view requires --subtree <sessionID>" }
      filters[filter] = parameters.subtreeOf
    } else {
      filters[filter] = value
    }
  }
  return { name: trimmed, filters, sort: definition.sort }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface ProjectStatusInput {
  view?: string
  rootId?: string
  subtreeOf?: string
  /** Inventory cap. `null` (or `all: true`) pages until exhausted. */
  limit?: number | null
  all?: boolean
  dbPath?: string
  host?: string | false
  cookie?: string
  password?: string
  runfilePath?: string
  pageSize?: number
  timeoutMs?: number
  fetchImpl?: FetchLike
  /** Pre-fetched live state (tests, or a caller that already has it). */
  live?: LiveState | null
  /** Explicit reason the live source is unavailable. */
  liveError?: string
  now?: number
  views?: ViewsDefinition
}

export interface ViewMembership {
  count: number
  ids: string[]
  skipped?: string
  isProxy?: boolean
  note?: string
}

export interface StatusProjection {
  sessions: ProjectedSession[]
  views: Record<string, ViewMembership>
  meta: {
    /** `<inventory>+host` when the live overlay was merged, else just the inventory source. */
    source: string
    inventorySource: "sqlite" | "host"
    capturedAt: string
    stale: boolean
    dbPath: string | null
    view: string
    inventoryLimit: number | null
    inventoryTotal: number | null
    scanned: number
    truncated: boolean
    ancestorLookups: number
    warnings: string[]
    unavailable: Record<string, { unavailable: true; reason: string }>
    viewsDefinition: string
  }
}

export async function projectStatus(input: ProjectStatusInput = {}): Promise<StatusProjection> {
  const views = input.views ?? loadViewsDefinition()
  const all = input.all === true
  const limit = all ? null : input.limit === null ? null : (input.limit ?? DEFAULT_INVENTORY_LIMIT)
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
  const dbPath = input.dbPath ?? defaultDbPath()
  const warnings: string[] = []

  // ---- inventory: SQLite first, then the paged host list if the DB is unreadable
  let opened: OpenedInventory
  let inventoryHost: string | false = input.host ?? (process.env.OPENCHAMBER_HOST as string | undefined) ?? DEFAULT_HOST
  try {
    opened = await openSqliteInventory(dbPath, { limit, pageSize })
  } catch (dbError) {
    const reason = dbError instanceof Error ? dbError.message : String(dbError)
    if (inventoryHost === false) {
      throw new Error(`session inventory unavailable: SQLite at ${dbPath} could not be read (${reason}) and no host was given`)
    }
    warnings.push(`SQLite inventory unavailable at ${dbPath} (${reason}); fell back to the paged host session list`)
    opened = await openHostInventory(inventoryHost, {
      limit,
      pageSize,
      cookie: input.cookie,
      password: input.password,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
    })
  }

  try {
    const { graph, ancestorLookups } = await buildGraph(opened.inventory, opened.lookupParent)

    // ---- live overlay
    let live: LiveState | null = input.live ?? null
    let stale = false
    if (input.liveError) {
      stale = true
      warnings.push(input.liveError)
    } else if (!live) {
      if (inventoryHost === false) {
        stale = true
        warnings.push("host disabled by caller; status is DB-derived only and pending forms are unknown")
      } else {
        try {
          live = await loadLiveState({
            host: inventoryHost,
            ...(input.cookie ? { cookie: input.cookie } : {}),
            ...(input.password ? { password: input.password } : {}),
            ...(input.runfilePath ? { runfilePath: input.runfilePath } : {}),
            ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          })
        } catch (liveFailure) {
          stale = true
          const reason = liveFailure instanceof Error ? liveFailure.message : String(liveFailure)
          warnings.push(`host live state unavailable (${reason}); status is DB-derived only and pending forms are unknown`)
        }
      }
    }

    // Orphan detection needs the host's active set. Without it a claimed row's
    // `orphaned` is unknown, so say so instead of letting the orphan arm of
    // needs-restart silently report zero.
    if (!live && viewUsesFilter(views, "orphaned")) {
      stale = true
      warnings.push(
        "orphan detection unavailable: the host live state was not read, so claimed sessions cannot be checked against the active set; " +
          "orphaned is unknown (never false) and only recorded outcomes are matched",
      )
    }

    const sessions = opened.inventory.rows.map((row) => projectSession(row, graph, live))
    const filterContext = (): FilterContext => ({
      views,
      ...(input.rootId ? { rootId: input.rootId } : {}),
      ...(input.subtreeOf ? { subtreeOf: input.subtreeOf } : {}),
      chainOf: graph.chainOf,
    })

    if (live) {
      const known = new Set(sessions.map((session) => session.id))
      const missing = [...live.running].filter((id) => !known.has(id))
      if (missing.length) {
        warnings.push(`${missing.length} running session(s) are outside the projected inventory (raise --limit or pass --all)`)
      }
    }

    // --root / --subtree select the matching view unless a view was named, so a
    // caller passing only an anchor never silently gets the default view.
    const requestedView = input.view ?? (input.subtreeOf ? "subtree" : input.rootId ? "tree" : "default")
    const selected = resolveView(views, requestedView, {
      ...(input.rootId ? { rootId: input.rootId } : {}),
      ...(input.subtreeOf ? { subtreeOf: input.subtreeOf } : {}),
    })

    const memberships: Record<string, ViewMembership> = {}
    for (const [name, definition] of Object.entries(views.views)) {
      const resolved = resolveView(views, name, {
        ...(input.rootId ? { rootId: input.rootId } : {}),
        ...(input.subtreeOf ? { subtreeOf: input.subtreeOf } : {}),
      })
      if (resolved.skipped) {
        memberships[name] = { count: 0, ids: [], skipped: resolved.skipped }
        continue
      }
      const context = filterContext()
      const ids: string[] = []
      for (const session of sessions) {
        if (matches(session, resolved.filters, context)) ids.push(session.id)
      }
      memberships[name] = {
        count: ids.length,
        ids,
        ...(definition.isProxy ? { isProxy: true } : {}),
        ...(definition.note ? { note: definition.note } : {}),
      }
    }

    if (selected.name.startsWith("tree:") || selected.name.startsWith("subtree:")) {
      const context = filterContext()
      const ids: string[] = []
      for (const session of sessions) {
        if (matches(session, selected.filters, context)) ids.push(session.id)
      }
      memberships[selected.name] = { count: ids.length, ids }
    }

    sessions.sort((a, b) => compareSessions(a, b, selected.sort, views.sort.tiebreak))

    return {
      sessions,
      views: memberships,
      meta: {
        source: `${opened.inventory.source}${live ? "+host" : ""}`,
        inventorySource: opened.inventory.source,
        capturedAt: new Date(input.now ?? Date.now()).toISOString(),
        stale,
        dbPath: opened.inventory.source === "sqlite" ? dbPath : null,
        view: selected.name,
        inventoryLimit: limit,
        inventoryTotal: opened.inventory.total,
        scanned: opened.inventory.scanned,
        truncated: opened.inventory.truncated,
        ancestorLookups,
        warnings,
        unavailable: unavailableFilters(views),
        viewsDefinition: "src/lib/views.json",
      },
    }
  } finally {
    opened.close()
  }
}

function compareSessions(a: ProjectedSession, b: ProjectedSession, sort: SortDefinition, tiebreak: SortDefinition): number {
  const direction = sort.direction === "asc" ? 1 : -1
  const left = sortValue(a, sort.field)
  const right = sortValue(b, sort.field)
  if (left !== right) return left < right ? -direction : direction
  const tie = tiebreak.direction === "asc" ? 1 : -1
  return a.id < b.id ? -tie : a.id > b.id ? tie : 0
}

function sortValue(session: ProjectedSession, field: string): number | string {
  switch (field) {
    case "depth":
      return session.depth
    case "id":
      return session.id
    case "lastActivity":
    default:
      return session.lastActivity ?? 0
  }
}

// ---------------------------------------------------------------------------
// Host inventory fallback (paged by the host's own cursor)
// ---------------------------------------------------------------------------

async function openHostInventory(
  host: string,
  options: { limit: number | null; pageSize: number; cookie?: string; password?: string; timeoutMs?: number; fetchImpl?: FetchLike },
): Promise<OpenedInventory> {
  const base = host.replace(/\/+$/, "")
  const fetchImpl = (options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike))
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable for the host inventory fallback")

  let cookie = options.cookie
  if (!cookie) {
    const port = Number(new URL(base).port || 3000)
    const credentials = readRunfileCredentials(runfilePathForPort(port))
    cookie = credentials.cookie
    const password = options.password ?? credentials.password
    if (!cookie && password && isLoopback(base)) {
      const login = await fetchImpl(`${base}/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!login.ok) throw new Error(`host login failed with HTTP ${login.status}`)
      cookie = cookieHeaderFrom(login) ?? undefined
    }
  }

  const rows: SessionRow[] = []
  const childCounts = new Map<string, number>()
  let cursor: string | null = null
  let exhausted = false
  while (!exhausted) {
    const want = options.limit === null ? options.pageSize : Math.min(options.pageSize, options.limit - rows.length)
    if (want <= 0) break
    const query = new URL(`${base}/api/session`)
    query.searchParams.set("limit", String(want))
    if (cursor) query.searchParams.set("cursor", cursor)
    const response = await fetchImpl(query.toString(), {
      ...(cookie ? { headers: { cookie } } : {}),
      ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    })
    if (!response.ok) throw new Error(`host session list returned HTTP ${response.status}`)
    const page = (await response.json()) as { data?: Array<Record<string, unknown>>; cursor?: { next?: string } }
    const data = Array.isArray(page.data) ? page.data : []
    for (const record of data) {
      const row = rowFromHost(record)
      if (!row) continue
      rows.push(row)
      if (row.parentId) childCounts.set(row.parentId, (childCounts.get(row.parentId) ?? 0) + 1)
    }
    const next = page.cursor?.next
    if (!next || data.length < want) exhausted = true
    else cursor = next
  }

  const byId = new Map(rows.map((row) => [row.id, row]))
  return {
    inventory: { rows, childCounts, total: null, scanned: rows.length, truncated: options.limit !== null && rows.length >= options.limit, source: "host" },
    lookupParent: (id) => byId.get(id)?.parentId ?? null,
    close: () => {},
  }
}
