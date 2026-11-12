// Workspace data layer: what the host bridge hands the panel.
//
// The panel reads nothing else. There is no fetch, no filesystem and no
// `/api/...` call in this bundle — every byte of session state arrives
// through `listProjects` / `onSessions` (capability `sessions`), and the
// preview harness answers the same messages with `preview/fixtures.json`.

import type {
  GuestDirectoryCoverage,
  GuestSessionsSnapshot,
  HostClient,
} from "@openchamber/sdk";
import type { HostSessionRecord } from "./selector";

export interface WorkspaceGap {
  id: string;
  /** Short chip label, e.g. `orphaned: unknown`. */
  label: string;
  /** The detail, written to follow the label. */
  text: string;
}

export interface WorkspaceData {
  state: "loading" | "ready" | "error";
  records: HostSessionRecord[];
  coverage: GuestDirectoryCoverage[];
  /** Data-source caveats the UI must show; absence of evidence is never silent. */
  gaps: WorkspaceGap[];
  /** True when at least one record carries an execution-claim flag. */
  claimEvidence: boolean;
  forkEvidence: boolean;
  scheduledEvidence: boolean;
  pendingFormEvidence: boolean;
  error?: string;
}

export type WorkspaceListener = (data: WorkspaceData) => void;

const EMPTY: WorkspaceData = {
  state: "loading",
  records: [],
  coverage: [],
  gaps: [],
  claimEvidence: false,
  forkEvidence: false,
  scheduledEvidence: false,
  pendingFormEvidence: false,
};

function evidence(records: HostSessionRecord[]): Pick<WorkspaceData, "claimEvidence" | "forkEvidence" | "scheduledEvidence" | "pendingFormEvidence"> {
  return {
    claimEvidence: records.some((record) => typeof record.claimed === "boolean"),
    forkEvidence: records.some((record) => typeof record.fork === "boolean"),
    scheduledEvidence: records.some((record) => typeof record.scheduled === "boolean"),
    pendingFormEvidence: records.some((record) => typeof record.pendingForm === "boolean"),
  };
}

/**
 * The gaps are derived from what the host actually sent, so the same panel
 * shows the honest state in production (no provenance fields at all) and the
 * exercised state in the preview harness (fixtures supply them).
 */
function gapsFor(data: Pick<WorkspaceData, "records" | "coverage" | "claimEvidence" | "forkEvidence" | "scheduledEvidence">): WorkspaceGap[] {
  const gaps: WorkspaceGap[] = [];
  const incomplete = data.coverage.filter((entry) => entry.state !== "ready");
  if (incomplete.length > 0) {
    gaps.push({
      id: "coverage",
      label: "inventory incomplete",
      text: `${incomplete.length} director${incomplete.length === 1 ? "y" : "ies"} still ${incomplete
        .map((entry) => `${entry.state} (${entry.directory})`)
        .join(", ")} — an empty view here is not proof of zero sessions.`,
    });
  }
  if (!data.claimEvidence) {
    gaps.push({
      id: "orphaned",
      label: "orphaned: unknown",
      text: "this host exposes no execution-claim state, so claimed-but-idle sessions cannot be detected. The orphan arm of needs-restart is unevaluable; never read that view as zero orphans.",
    });
  }
  if (!data.forkEvidence) {
    gaps.push({
      id: "fork",
      label: "fork: unknown",
      text: "no fork flag on the workspace record, so the default proxy cannot exclude forked roots (it widens instead of hiding rows).",
    });
  }
  if (!data.scheduledEvidence) {
    gaps.push({
      id: "scheduled",
      label: "scheduled: unknown",
      text: "no metadata source — a scheduled session that was never labelled is indistinguishable from a user-started one (the widening views.json documents for the default proxy).",
    });
  }
  gaps.push({
    id: "outcome",
    label: "interrupted: never",
    text: "the host vocabulary is completed | failed | null, so `interrupted` (the second arm of needs-restart) can never match from this source.",
  });
  return gaps;
}

/**
 * Subscribe to projects and to every project's session list. Returns an
 * unsubscribe function; snapshots replace (never merge) the previous state.
 */
export function startWorkspace(host: HostClient, listener: WorkspaceListener): () => void {
  let disposed = false;
  const unsubscribers: Array<() => void> = [];
  const projectSnapshots = new Map<string, GuestSessionsSnapshot>();
  let failure: string | null = null;

  const emit = (): void => {
    if (disposed) return;
    const records: HostSessionRecord[] = [];
    const coverage: GuestDirectoryCoverage[] = [];
    for (const snapshot of projectSnapshots.values()) {
      records.push(...(snapshot.sessions as HostSessionRecord[]));
      coverage.push(...snapshot.coverage);
    }
    const states = [...projectSnapshots.values()].map((snapshot) => snapshot.state);
    const ready = states.length > 0 && states.every((state) => state === "ready");
    const loading = states.length === 0 || states.some((state) => state === "loading");
    const state: WorkspaceData["state"] = failure ? "error" : ready ? "ready" : loading ? "loading" : "ready";
    const base = {
      records,
      coverage,
      ...evidence(records),
    };
    listener({
      state,
      ...base,
      gaps: gapsFor(base),
      ...(failure ? { error: failure } : {}),
    });
  };

  void (async () => {
    try {
      const snapshot = await host.listProjects();
      if (disposed) return;
      for (const project of snapshot.projects) {
        if (disposed) return;
        const unsubscribe = await host.onSessions(project.id, (sessions) => {
          if (disposed) return;
          projectSnapshots.set(project.id, sessions);
          emit();
        });
        unsubscribers.push(unsubscribe);
      }
      emit();
    } catch (error) {
      if (disposed) return;
      failure = error instanceof Error ? error.message : String(error);
      emit();
    }
  })();

  return () => {
    disposed = true;
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe();
      } catch {
        // A released subscription is not an error worth surfacing.
      }
    }
  };
}

export const emptyWorkspace = (): WorkspaceData => ({ ...EMPTY, records: [], coverage: [], gaps: [] });
