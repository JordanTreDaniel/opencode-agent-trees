// The single declarative definition of the filter vocabulary and the named
// views is `src/lib/views.json` in this repository — the same file
// `src/lib/status.ts` and `scripts/tree-status.mjs` read. This module imports
// it into the panel bundle so the extension cannot re-declare a view.
//
// What IS duplicated here (and only this) is the selector implementation:
// `src/lib/status.ts` evaluates the same filters against SQLite + host rows,
// while the panel evaluates them against the OpenChamber workspace API. The
// duplication is deliberate — the panel must not import `node:fs` — and it is
// called out in extension/README.md so drift stays visible.

import viewsJson from "../../src/lib/views.json";

export interface FilterDefinition {
  type?: string;
  derived?: string;
  description?: string;
  reason?: string;
  note?: string;
  /** Present and true when no source exists for the filter. */
  unavailable?: boolean;
}

export interface SortDefinition {
  field: string;
  direction: "asc" | "desc";
}

export interface ViewDefinition {
  filters: Record<string, unknown>;
  sort: SortDefinition;
  isProxy?: boolean;
  proxyNote?: string;
  note?: string;
  parameters?: string[];
}

export interface ViewsDefinition {
  version: number;
  sources?: Record<string, string>;
  operators?: Record<string, string>;
  sort: { default: SortDefinition; tiebreak: SortDefinition; fields?: Record<string, string> };
  filters: Record<string, FilterDefinition>;
  views: Record<string, ViewDefinition>;
}

/** The imported definition. Nothing in the panel re-states a view or a filter. */
export const VIEWS: ViewsDefinition = viewsJson as ViewsDefinition;

export interface ResolvedView {
  name: string;
  filters: Record<string, unknown>;
  sort: SortDefinition;
  /** Set when a parameterised view was named without its anchor. */
  skipped?: string;
}

/**
 * Resolve a view name to its filter set. `tree:<id>` / `subtree:<id>` are the
 * one-token forms, exactly as `src/lib/status.ts` accepts them.
 */
export function resolveView(
  name: string,
  parameters: { rootId?: string | undefined; subtreeOf?: string | undefined } = {},
): ResolvedView {
  const trimmed = name.trim();

  if (trimmed.startsWith("tree:")) {
    const anchor = trimmed.slice("tree:".length).trim();
    if (!anchor) return { name: trimmed, filters: {}, sort: VIEWS.views.tree?.sort ?? VIEWS.sort.default, skipped: "view tree:<rootId> requires a root id" };
    return { name: trimmed, filters: { rootId: anchor }, sort: VIEWS.views.tree?.sort ?? VIEWS.sort.default };
  }
  if (trimmed.startsWith("subtree:")) {
    const anchor = trimmed.slice("subtree:".length).trim();
    if (!anchor) return { name: trimmed, filters: {}, sort: VIEWS.views.subtree?.sort ?? VIEWS.sort.default, skipped: "view subtree:<id> requires a session id" };
    return { name: trimmed, filters: { isSubtreeOf: anchor }, sort: VIEWS.views.subtree?.sort ?? VIEWS.sort.default };
  }

  const definition = VIEWS.views[trimmed];
  if (!definition) throw new Error(`unknown view: ${trimmed} (known: ${Object.keys(VIEWS.views).join(", ")})`);

  const filters: Record<string, unknown> = {};
  for (const [filter, value] of Object.entries(definition.filters)) {
    if (value === "$root") {
      if (!parameters.rootId) return { name: trimmed, filters: {}, sort: definition.sort, skipped: "view requires a root id" };
      filters[filter] = parameters.rootId;
    } else if (value === "$subtree") {
      if (!parameters.subtreeOf) return { name: trimmed, filters: {}, sort: definition.sort, skipped: "view requires a session id" };
      filters[filter] = parameters.subtreeOf;
    } else {
      filters[filter] = value;
    }
  }
  return { name: trimmed, filters, sort: definition.sort };
}

/** Filters with no data source, in the shape the panel shows them. */
export function unavailableFilters(): Record<string, { unavailable: true; reason: string }> {
  const out: Record<string, { unavailable: true; reason: string }> = {};
  for (const [name, definition] of Object.entries(VIEWS.filters)) {
    if (definition.unavailable) out[name] = { unavailable: true, reason: definition.reason ?? "no source" };
  }
  return out;
}

/** Human rendering of a view's filter set, e.g. `isRoot ∧ ¬fork ∧ ¬scheduled`. */
export function describeFilters(filters: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(filters)) {
    if (name === "$any" && Array.isArray(value)) {
      parts.push(`(${$any(value as Record<string, unknown>[])})`);
      continue;
    }
    if (value === false) parts.push(`¬${name}`);
    else if (value === true) parts.push(name);
    else parts.push(`${name} = ${renderValue(value)}`);
  }
  return parts.length > 0 ? parts.join(" ∧ ") : "no filters";
}

function $any(groups: Record<string, unknown>[]): string {
  return groups.map((group) => describeFilters(group)).join(" ∨ ");
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => JSON.stringify(entry)).join(" | ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  if (value === false) return "false";
  if (value === true) return "true";
  return JSON.stringify(value);
}
