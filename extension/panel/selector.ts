// Selector implementation for the panel.
//
// DUPLICATED LOGIC — deliberately. `src/lib/status.ts` evaluates this same
// filter vocabulary against the OpenCode SQLite inventory plus the host's
// `/api/session/active` + `/api/sessions/status`. The panel runs in a
// sandboxed iframe with no filesystem and no raw network, so it evaluates the
// same vocabulary against the OpenChamber workspace API
// (`listProjects` / `onSessions`) instead. The *definitions* (which filters
// exist, which views exist, their filter sets and sorts) are NOT duplicated:
// they are imported from `src/lib/views.json` by `./views.ts`.
//
// Only the selector is ported: projectSession → projectSessions, matches(),
// resolveView() (in ./views.ts) and the sort. Field-by-field derivation notes
// are on each property of ProjectedSession.

import type { GuestSessionActivity, GuestSessionRecord } from "@openchamber/sdk";
import { VIEWS, type ViewsDefinition } from "./views";

/**
 * The workspace record plus the provenance fields OpenChamber 2.6.1 does not
 * send (`fork`, `scheduled`, `claimed`, `pendingForm`). The preview harness
 * supplies them so the fork / scheduled / orphan arms can be exercised; when
 * they are absent the panel widens the default proxy and reports the gap
 * instead of guessing. See extension/README.md § Known gaps.
 */
export interface HostSessionRecord extends GuestSessionRecord {
  fork?: boolean;
  scheduled?: boolean;
  claimed?: boolean;
  pendingForm?: boolean;
}

export type SessionStatus = "running" | "idle" | "unknown";
export type MappedOutcome = "succeeded" | "failed" | "interrupted" | "none";

export interface ProjectedSession {
  id: string;
  title: string;
  projectId: string;
  directory: string;
  activity: GuestSessionActivity;
  parentId: string | null;
  /** Walk of parent ids up to the root, self first. */
  chain: string[];
  rootId: string;
  /** Hops to the root; a root is 0. Derived client-side — the host has no depth. */
  depth: number;
  childCount: number;
  isRoot: boolean;
  hasParent: boolean;
  inTree: boolean;
  isLeaf: boolean;
  status: SessionStatus;
  archived: boolean;
  claimed: boolean | null;
  orphaned: boolean | null;
  fork: boolean;
  /** False when the host sent no fork flag at all (unknown ≠ false). */
  forkKnown: boolean;
  scheduled: boolean;
  scheduledKnown: boolean;
  hasPendingForm: boolean;
  pendingFormKnown: boolean;
  paused: boolean;
  outcome: MappedOutcome;
  outcomeRaw: "completed" | "failed" | null;
  lastActivity: number | null;
  createdAt: number;
  updatedAt: number;
}

const MAX_CHAIN = 256;

/**
 * `activity` → the three-state `status` vocabulary of views.json.
 * A turn in flight (`running`, `retrying`) holds the claim; so do the two
 * blocked-on-user activities (`waiting-permission`, `waiting-question`) —
 * views.json: "a paused session still reports running".
 */
export function statusOf(activity: GuestSessionActivity): SessionStatus {
  switch (activity) {
    case "running":
    case "retrying":
    case "waiting-permission":
    case "waiting-question":
      return "running";
    case "idle":
      return "idle";
    default:
      return "unknown";
  }
}

/** Host `outcome` (`completed` | `failed` | null) → views.json's vocabulary. */
export function outcomeOf(raw: "completed" | "failed" | null): MappedOutcome {
  if (raw === "completed") return "succeeded";
  if (raw === "failed") return "failed";
  return "none";
}

export function projectSessions(records: readonly HostSessionRecord[]): ProjectedSession[] {
  const byId = new Map<string, HostSessionRecord>(records.map((record) => [record.id, record]));
  const childCounts = new Map<string, number>();
  for (const record of records) {
    if (!record.parentId) continue;
    childCounts.set(record.parentId, (childCounts.get(record.parentId) ?? 0) + 1);
  }

  const chains = new Map<string, string[]>();
  const chainOf = (id: string): string[] => {
    const cached = chains.get(id);
    if (cached) return cached;
    const chain: string[] = [id];
    const seen = new Set<string>([id]);
    let cursor = byId.get(id)?.parentId ?? null;
    while (cursor && !seen.has(cursor) && chain.length < MAX_CHAIN) {
      chain.push(cursor);
      seen.add(cursor);
      // A parent outside the listed inventory ends the walk: the panel cannot
      // query rows the host did not hand it.
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    chains.set(id, chain);
    return chain;
  };

  return records.map((record) => {
    const chain = chainOf(record.id);
    const childCount = childCounts.get(record.id) ?? 0;
    const status = statusOf(record.activity);
    const claimed = typeof record.claimed === "boolean" ? record.claimed : null;
    const pendingFormKnown = typeof record.pendingForm === "boolean";
    // A waiting-question activity IS a live pending form; the explicit flag
    // covers fixtures (and future hosts) that report a form on a non-waiting
    // activity — a stale form, whose turn has ended.
    const hasPendingForm = record.activity === "waiting-question" || record.pendingForm === true;
    // orphaned = claimed ∧ ¬running, tri-state. Unknown stays null: an
    // unreadable claim is never reported as "no orphan".
    const orphaned = claimed === null ? null : claimed ? (status === "running" ? false : status === "idle" ? true : null) : false;

    return {
      id: record.id,
      title: record.title,
      projectId: record.projectId,
      directory: record.directory,
      activity: record.activity,
      parentId: record.parentId,
      chain,
      rootId: chain[chain.length - 1] ?? record.id,
      depth: Math.max(0, chain.length - 1),
      childCount,
      isRoot: record.parentId === null,
      hasParent: record.parentId !== null,
      inTree: record.parentId !== null || childCount > 0,
      isLeaf: childCount === 0,
      status,
      archived: record.archivedAt !== null,
      claimed,
      fork: record.fork === true,
      forkKnown: typeof record.fork === "boolean",
      scheduled: record.scheduled === true,
      scheduledKnown: typeof record.scheduled === "boolean",
      hasPendingForm,
      pendingFormKnown,
      paused: status === "running" && record.activity === "waiting-question",
      outcome: outcomeOf(record.outcome),
      outcomeRaw: record.outcome,
      lastActivity: Math.max(record.updatedAt ?? 0, record.createdAt ?? 0) || null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      orphaned,
    } satisfies ProjectedSession;
  });
}

// ---------------------------------------------------------------------------
// Filter evaluation (port of src/lib/status.ts `matches`)
// ---------------------------------------------------------------------------

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function epoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function matchesDepth(actual: number, expected: unknown): boolean {
  if (typeof expected === "number") return actual === expected;
  if (expected && typeof expected === "object") {
    const bounds = expected as { min?: unknown; max?: unknown };
    if (typeof bounds.min === "number" && actual < bounds.min) return false;
    if (typeof bounds.max === "number" && actual > bounds.max) return false;
    return true;
  }
  return true;
}

function matchesOutcome(session: ProjectedSession, expected: unknown): boolean {
  const wanted = asArray(expected).map((value) => value.toLowerCase());
  return wanted.includes(session.outcome.toLowerCase());
}

function matchesLastActivity(session: ProjectedSession, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    const range = expected as { after?: unknown; before?: unknown };
    const after = range.after === undefined ? null : epoch(range.after);
    const before = range.before === undefined ? null : epoch(range.before);
    if (after !== null && (session.lastActivity === null || session.lastActivity < after)) return false;
    if (before !== null && (session.lastActivity === null || session.lastActivity >= before)) return false;
    return true;
  }
  const since = epoch(expected);
  if (since === null) return true;
  return session.lastActivity !== null && session.lastActivity >= since;
}

interface FilterContext {
  views: ViewsDefinition;
}

export function matches(session: ProjectedSession, filters: Record<string, unknown>, context: FilterContext): boolean {
  for (const [name, expected] of Object.entries(filters)) {
    if (name === "$any") {
      if (!Array.isArray(expected) || expected.length === 0) throw new Error("$any expects a non-empty array of filter sets");
      const matchesAny = expected.some((group) => {
        if (!group || typeof group !== "object" || Array.isArray(group)) throw new Error("$any expects an array of filter sets");
        return matches(session, group as Record<string, unknown>, context);
      });
      if (!matchesAny) return false;
      continue;
    }
    const definition = context.views.filters[name];
    if (!definition) throw new Error(`unknown filter: ${name}`);
    if (definition.unavailable) throw new Error(`filter ${name} is unavailable: ${definition.reason ?? "no source"}`);
    switch (name) {
      case "isRoot":
        if (session.isRoot !== Boolean(expected)) return false;
        break;
      case "hasParent":
        if (session.hasParent !== Boolean(expected)) return false;
        break;
      case "parentId":
        if (session.parentId !== String(expected)) return false;
        break;
      case "rootId":
        if (session.rootId !== String(expected)) return false;
        break;
      case "depth":
        if (!matchesDepth(session.depth, expected)) return false;
        break;
      case "inTree":
        if (session.inTree !== Boolean(expected)) return false;
        break;
      case "isSubtreeOf":
        // Self-inclusive: a session belongs to its own subtree.
        if (!session.chain.includes(String(expected))) return false;
        break;
      case "isLeaf":
        if (session.isLeaf !== Boolean(expected)) return false;
        break;
      case "status":
        if (!asArray(expected).includes(session.status)) return false;
        break;
      case "hasPendingForm":
        if (session.hasPendingForm !== Boolean(expected)) return false;
        break;
      case "archived":
        if (session.archived !== Boolean(expected)) return false;
        break;
      case "claimed":
        if (session.claimed !== Boolean(expected)) return false;
        break;
      case "orphaned":
        // Tri-state: null satisfies neither true nor false, so an unknown
        // orphan is never reported as a non-orphan (or as an orphan).
        if (session.orphaned !== Boolean(expected)) return false;
        break;
      case "project":
        if (session.projectId !== String(expected)) return false;
        break;
      case "lastActivity":
        if (!matchesLastActivity(session, expected)) return false;
        break;
      case "outcome":
        if (!matchesOutcome(session, expected)) return false;
        break;
      case "fork":
        if (session.fork !== Boolean(expected)) return false;
        break;
      case "scheduled":
        if (session.scheduled !== Boolean(expected)) return false;
        break;
      default:
        throw new Error(`filter ${name} is declared but not implemented`);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sort (port of src/lib/status.ts `compareSessions`)
// ---------------------------------------------------------------------------

export function sortSessions(sessions: ProjectedSession[], sort: { field: string; direction: string }): ProjectedSession[] {
  const tiebreak = VIEWS.sort.tiebreak;
  return [...sessions].sort((a, b) => {
    const direction = sort.direction === "asc" ? 1 : -1;
    const left = sortValue(a, sort.field);
    const right = sortValue(b, sort.field);
    if (left !== right) return left < right ? -direction : direction;
    const tie = tiebreak.direction === "asc" ? 1 : -1;
    return a.id < b.id ? -tie : a.id > b.id ? tie : 0;
  });
}

/**
 * Drill-down ordering: `tree:` / `subtree:` sort by derived depth first (the
 * host has no depth; the panel walks `parentId`), then the views.json
 * lastActivity order. This is the one deliberate ordering divergence from
 * views.json and is documented in extension/README.md.
 */
export function sortSessionsByDepth(sessions: ProjectedSession[]): ProjectedSession[] {
  return [...sessions].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const left = a.lastActivity ?? 0;
    const right = b.lastActivity ?? 0;
    if (left !== right) return right - left;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function sortValue(session: ProjectedSession, field: string): number | string {
  switch (field) {
    case "depth":
      return session.depth;
    case "id":
      return session.id;
    case "lastActivity":
      // views.json: null sorts last in a descending order.
      return session.lastActivity ?? Number.NEGATIVE_INFINITY;
    default:
      return session.lastActivity ?? Number.NEGATIVE_INFINITY;
  }
}
