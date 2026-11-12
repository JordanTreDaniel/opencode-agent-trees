// The panel's view layer: one switcher, six views, the proxy caveat, the
// data-gap surface and the filter-vocabulary panel.
//
// Definitions come from `src/lib/views.json` (through ./views.ts). This file
// only renders them; it never re-states a view's filters.

import type { HostClient, HostReadyContext } from "@openchamber/sdk";
import { mountSelect, mountTabs, type SelectHandle, type TabsHandle } from "@openchamber/sdk/ui";
import { startWorkspace, type WorkspaceData } from "./data";
import {
  matches,
  projectSessions,
  sortSessions,
  sortSessionsByDepth,
  type ProjectedSession,
} from "./selector";
import { PANEL_CSS } from "./styles";
import { VIEWS, describeFilters, resolveView } from "./views";

type TabId = "default" | "running" | "needs-restart" | "question-paused" | "tree" | "subtree";

const BASE_TABS: TabId[] = ["default", "running", "needs-restart", "question-paused"];
const ALL_TABS: TabId[] = [...BASE_TABS, "tree", "subtree"];

const VIEW_NOTES: Record<string, { text: string; tone?: "warning" }> = {
  running: {
    text: "status = running means a turn is in flight or the session holds the execution claim. Question-paused sessions are a SUBSET — they still report running, which is exactly why question-paused needs hasPendingForm as a second filter.",
  },
  "question-paused": {
    text: "Verification surface for pause/resume: pause reports `paused` only after a NEW pending form and the execution claim are both observed (the session matches this view); resume reports `resumed` only after the form has left the pending set (the session has left it).",
  },
  tree: {
    text: "Every session in one tree, ordered by DERIVED depth — the host exposes no depth, so the panel walks parentId itself.",
  },
  subtree: {
    text: "One session and everything beneath it (self-inclusive), ordered by DERIVED depth — the host exposes no depth, so the panel walks parentId itself.",
  },
};

interface Selection {
  tab: TabId;
  rootId: string | null;
  subtreeId: string | null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const shortId = (id: string): string => (id.length > 18 ? `${id.slice(0, 15)}…` : id);

function ago(ms: number | null): string {
  if (!ms) return "no activity";
  const delta = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function descendantsOf(id: string, projected: ProjectedSession[]): number {
  return projected.filter((session) => session.chain.includes(id) && session.id !== id).length;
}

/** Most active tree root by subtree size; `null` when there are no roots. */
function defaultRootAnchor(projected: ProjectedSession[]): string | null {
  const roots = projected.filter((session) => session.isRoot);
  roots.sort((a, b) => descendantsOf(b.id, projected) - descendantsOf(a.id, projected) || (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  return roots[0]?.id ?? null;
}

/** Largest non-root subtree, so `subtree:` never opens as a copy of `tree:`. */
function defaultSubtreeAnchor(projected: ProjectedSession[]): string | null {
  const candidates = projected.filter((session) => !session.isRoot && descendantsOf(session.id, projected) > 0);
  candidates.sort((a, b) => descendantsOf(b.id, projected) - descendantsOf(a.id, projected) || (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  return candidates[0]?.id ?? null;
}

interface Chips {
  unavailable: HTMLButtonElement;
  gaps: HTMLSpanElement;
}

export function mountApp(root: HTMLElement, host: HostClient): () => void {
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  document.head.append(style);

  const shell = el("div", "ov-shell");

  // --- header ------------------------------------------------------------
  const header = el("header", "ov-header");
  const titlebar = el("div", "ov-titlebar");
  const title = el("h1", "ov-title", "Session views");
  const subtitle = el("span", "ov-subtitle", "agent trees · src/lib/views.json");
  title.append(subtitle);
  const chipRow = el("div", "ov-chips");
  titlebar.append(title, chipRow);
  const switcher = el("div", "ov-switcher");
  header.append(titlebar, switcher);

  const viewline = el("div", "ov-viewline");
  const body = el("div", "ov-body");
  const vocab = el("section", "ov-vocab");
  vocab.setAttribute("aria-label", "Filter vocabulary");
  const vocabToggle = el("button", "ov-vocab-toggle");
  vocabToggle.type = "button";
  vocabToggle.setAttribute("aria-expanded", "false");
  const vocabBody = el("div", "ov-vocab-body");
  vocabBody.hidden = true;
  vocab.append(vocabToggle, vocabBody);

  shell.append(header, viewline, body, vocab);
  root.append(shell);

  // --- persistent regions inside the body --------------------------------
  const notices = el("div");
  notices.id = "ov-notices";
  const anchorRegion = el("div");
  anchorRegion.id = "ov-anchor";
  const content = el("div");
  content.id = "ov-content";
  content.className = "ov-rows";
  body.append(notices, anchorRegion, content);

  // --- state -------------------------------------------------------------
  const selection: Selection = { tab: "default", rootId: null, subtreeId: null };
  let data: WorkspaceData = {
    state: "loading",
    records: [],
    coverage: [],
    gaps: [],
    claimEvidence: false,
    forkEvidence: false,
    scheduledEvidence: false,
    pendingFormEvidence: false,
  };
  let projected: ProjectedSession[] = [];
  let vocabOpen = false;

  const chips: Chips = {
    unavailable: el("button", "ov-chip", "unavailable: userSpawned, waveIndex"),
    gaps: el("span", "ov-chip", ""),
  };
  chips.unavailable.type = "button";
  chips.unavailable.dataset.tone = "error";
  chips.unavailable.title = "Show the filter vocabulary: these two filters have no source anywhere.";
  chips.unavailable.addEventListener("click", () => setVocab(true));
  chips.gaps.dataset.tone = "warning";
  chipRow.append(chips.unavailable, chips.gaps);

  let tabs: TabsHandle | null = null;
  let anchorSelect: SelectHandle | null = null;
  let anchorSignature = "";

  const setVocab = (open: boolean): void => {
    vocabOpen = open;
    vocabBody.hidden = !open;
    vocabToggle.setAttribute("aria-expanded", String(open));
    if (open) vocabBody.scrollIntoView({ block: "nearest" });
    renderVocab();
  };

  vocabToggle.addEventListener("click", () => setVocab(!vocabOpen));

  // --- membership --------------------------------------------------------
  const membersFor = (tab: TabId): ProjectedSession[] => {
    if (tab === "tree") {
      if (!selection.rootId) return [];
      return sortSessionsByDepth(projected.filter((session) => matches(session, { rootId: selection.rootId }, { views: VIEWS })));
    }
    if (tab === "subtree") {
      if (!selection.subtreeId) return [];
      return sortSessionsByDepth(projected.filter((session) => matches(session, { isSubtreeOf: selection.subtreeId }, { views: VIEWS })));
    }
    const resolved = resolveView(tab);
    const matched = projected.filter((session) => matches(session, resolved.filters, { views: VIEWS }));
    return sortSessions(matched, resolved.sort);
  };

  const viewNameFor = (): string => {
    if (selection.tab === "tree") return selection.rootId ? `tree:${selection.rootId}` : "tree";
    if (selection.tab === "subtree") return selection.subtreeId ? `subtree:${selection.subtreeId}` : "subtree";
    return selection.tab;
  };

  // --- rows --------------------------------------------------------------
  const badge = (label: string, tone?: string): HTMLSpanElement => {
    const node = el("span", "ov-badge", label);
    if (tone) node.dataset.tone = tone;
    return node;
  };

  const renderRow = (session: ProjectedSession, indent: boolean): HTMLButtonElement => {
    const row = el("button", "ov-row");
    row.type = "button";
    row.dataset.indent = indent ? "true" : "false";
    row.style.setProperty("--d", String(session.depth));
    row.title = `${session.id} — click to open this session`;

    const head = el("span", "ov-row-head");
    head.append(el("span", "ov-id", shortId(session.id)));
    head.append(el("span", "ov-row-title", session.title || "(untitled session)"));

    const badges = el("span", "ov-badges");
    if (session.status === "running") badges.append(badge("running", "success"));
    else if (session.status === "idle") badges.append(badge("idle"));
    else badges.append(badge("unknown"));

    if (session.paused) badges.append(badge("question-paused", "warning"));
    else if (session.activity === "waiting-permission") badges.append(badge("waiting permission", "info"));
    else if (session.activity === "retrying") badges.append(badge("retrying", "info"));

    if (session.hasPendingForm && !session.paused && !session.pendingFormKnown) {
      badges.append(badge("pending form", "warning"));
    } else if (session.hasPendingForm && !session.paused) {
      badges.append(badge("stale form (turn ended)", "warning"));
    }
    if (session.outcome === "failed") badges.append(badge("failed outcome", "error"));
    if (session.archived) badges.append(badge("archived"));
    if (session.orphaned === true) badges.append(badge("orphaned claim", "error"));
    if (selection.tab === "needs-restart" && session.orphaned === null) badges.append(badge("orphaned: unknown"));
    if (session.forkKnown && session.fork) badges.append(badge("fork"));
    if (session.scheduledKnown && session.scheduled) badges.append(badge("scheduled"));
    head.append(badges);

    const sub = el("span", "ov-row-sub");
    const left = el("span", "ov-mono");
    left.textContent = `depth ${session.depth} · root ${shortId(session.rootId)} · ${session.projectId}`;
    const right = el("span", "ov-time", ago(session.lastActivity));
    sub.append(left, right);

    row.append(head, sub);
    row.addEventListener("click", () => {
      void host.openSession(session.id).catch(() => undefined);
    });
    return row;
  };

  // --- notices -----------------------------------------------------------
  const proxyBox = (): HTMLElement => {
    const box = el("div", "ov-proxy");
    const head = el("div", "ov-proxy-head");
    head.append(badge("PROXY — best guess", "warning"));
    head.append(el("span", undefined, "root ∧ ¬fork ∧ kind ≠ 'scheduled'"));
    const paragraph = el("div", "ov-proxy-body");
    paragraph.append(
      el(
        "span",
        undefined,
        "best guess — includes workflow/queue/API sessions. ",
      ),
    );
    const code = el("code", undefined, "userSpawned");
    paragraph.append(code, el("span", undefined, " has no source anywhere, so “a conversation the user started” cannot be computed. This view is the documented approximation: "));
    const expression = el("code", undefined, "isRoot ∧ ¬fork ∧ ¬scheduled");
    paragraph.append(expression, el("span", undefined, ". A scheduled session that was never labelled is indistinguishable from a user one."));
    box.append(head, paragraph);

    if (!data.forkEvidence || !data.scheduledEvidence) {
      const gap = el("div", "ov-proxy-body");
      gap.append(
        el(
          "span",
          undefined,
          "Host gap: this host sends no fork or scheduled flag, so neither arm can actually exclude a row here — the proxy widens silently rather than hiding sessions.",
        ),
      );
      box.append(gap);
    }
    return box;
  };

  const gapsCard = (): HTMLElement => {
    const card = el("div", "ov-gaps");
    const head = el("div", "ov-gaps-head");
    head.append(badge("data gaps", "warning"));
    for (const gap of data.gaps) {
      const tone = gap.id === "outcome" ? "muted" : "warning";
      head.append(badge(gap.label, tone));
    }
    const list = el("ul");
    for (const gap of data.gaps) {
      const item = el("li");
      if (gap.id === "outcome") item.dataset.tone = "muted";
      item.append(el("strong", undefined, `${gap.label}: `), el("span", undefined, gap.text));
      list.append(item);
    }
    card.append(head, list);
    return card;
  };

  const noteBox = (viewName: string, members: ProjectedSession[]): HTMLElement | null => {
    if (viewName === "needs-restart") {
      const note = el("div", "ov-note");
      note.dataset.tone = "warning";
      const orphans = members.filter((session) => session.orphaned === true).length;
      if (!data.claimEvidence) {
        note.append(
          el("strong", undefined, "orphan arm: unknown. "),
          el(
            "span",
            undefined,
            `${members.length} row(s) below come from recorded outcomes ONLY. Claimed-but-idle sessions are invisible to this view — this is not zero restart candidates.`,
          ),
        );
      } else {
        note.append(
          el("strong", undefined, "orphan arm evaluated from host claim evidence. "),
          el("span", undefined, `${orphans} orphaned claim(s) listed beside ${members.length - orphans} failed/interrupted outcome(s).`),
        );
      }
      return note;
    }
    const key = viewName.startsWith("tree:") ? "tree" : viewName.startsWith("subtree:") ? "subtree" : viewName;
    const meta = VIEW_NOTES[key];
    if (!meta) return null;
    const note = el("div", "ov-note");
    if (meta.tone) note.dataset.tone = meta.tone;
    note.append(el("strong", undefined, `${viewName}: `), el("span", undefined, meta.text));
    return note;
  };

  // --- vocabulary --------------------------------------------------------
  const availabilityOf = (name: string): { key: "available" | "derived" | "unknown" | "unavailable"; label: string } => {
    const definition = VIEWS.filters[name];
    if (definition?.unavailable) return { key: "unavailable", label: "unavailable" };
    if (name === "claimed" || name === "orphaned") {
      return data.claimEvidence
        ? { key: "derived", label: "derived from claim evidence" }
        : { key: "unknown", label: "unknown on this host" };
    }
    if (name === "fork") return data.forkEvidence ? { key: "derived", label: "derived" } : { key: "unknown", label: "unknown on this host" };
    if (name === "scheduled") return data.scheduledEvidence ? { key: "derived", label: "derived" } : { key: "unknown", label: "unknown (widened)" };
    if (name === "hasPendingForm") return { key: "derived", label: "derived from activity" };
    if (name === "outcome") return { key: "derived", label: "derived (no interrupted)" };
    return { key: "available", label: "available" };
  };

  const renderVocab = (): void => {
    const names = Object.keys(VIEWS.filters);
    const unavailableCount = names.filter((name) => VIEWS.filters[name].unavailable).length;
    vocabToggle.replaceChildren(
      el("span", undefined, `Filter vocabulary · ${names.length} filters`),
      el("span", "ov-vocab-hint", `${unavailableCount} unavailable: userSpawned, waveIndex`),
    );
    if (!vocabOpen) return;
    vocabBody.replaceChildren();
    for (const name of names) {
      const definition = VIEWS.filters[name];
      const availability = availabilityOf(name);
      const row = el("div", "ov-vocab-row");
      row.dataset.avail = availability.key;
      row.append(el("div", "ov-vocab-name", name));
      row.append(el("div", "ov-vocab-desc", definition.description ?? definition.reason ?? ""));
      row.append(badge(availability.label, availability.key === "unavailable" ? "error" : availability.key === "unknown" ? "warning" : availability.key === "available" ? "success" : "neutral"));
      row.append(el("div", "ov-vocab-type", `type: ${definition.type ?? "boolean"} · derived: ${definition.derived ?? (definition.unavailable ? "no source" : "—")}`));
      vocabBody.append(row);
    }
  };

  // --- render ------------------------------------------------------------
  const render = (): void => {
    projected = projectSessions(data.records);
    // Fill drill-down anchors as soon as there are sessions to anchor on, so
    // the tree/subtree tabs always carry a count.
    if (!selection.rootId) selection.rootId = defaultRootAnchor(projected);
    if (!selection.subtreeId) selection.subtreeId = defaultSubtreeAnchor(projected);

    const counts = new Map<TabId, number>();
    for (const tab of BASE_TABS) counts.set(tab, membersFor(tab).length);
    if (selection.rootId) counts.set("tree", membersFor("tree").length);
    if (selection.subtreeId) counts.set("subtree", membersFor("subtree").length);

    const items = ALL_TABS.map((tab) => {
      const label = tab === "default" ? "default (proxy)" : tab === "tree" ? "tree:root" : tab === "subtree" ? "subtree:" : tab;
      const count = counts.get(tab);
      return { id: tab, label, ...(count === undefined ? {} : { count }) };
    });
    if (!tabs) {
      tabs = mountTabs(switcher, {
        items,
        activeId: selection.tab,
        trackBackground: true,
        onChange: (id) => selectTab(id as TabId),
      });
    } else {
      tabs.update({ items, activeId: selection.tab });
    }

    chips.gaps.textContent = data.gaps.length === 0 ? "no data gaps" : `${data.gaps.length} data gap${data.gaps.length === 1 ? "" : "s"}`;
    chips.gaps.dataset.tone = data.gaps.length === 0 ? "success" : "warning";

    // view line
    const viewName = viewNameFor();
    const resolved = resolveView(viewName, { rootId: selection.rootId ?? undefined, subtreeOf: selection.subtreeId ?? undefined });
    viewline.replaceChildren();
    viewline.append(el("strong", undefined, viewName));
    viewline.append(el("span", "ov-filters", resolved.skipped ? "waiting for an anchor" : describeFilters(resolved.filters)));
    if (VIEWS.views.default?.isProxy && selection.tab === "default") viewline.append(badge("isProxy: true", "warning"));
    if (resolved.skipped) viewline.append(badge("anchor required", "warning"));

    // notices
    notices.replaceChildren();
    const stack = el("div");
    stack.style.display = "flex";
    stack.style.flexDirection = "column";
    stack.style.gap = "10px";
    if (selection.tab === "default") stack.append(proxyBox());
    stack.append(gapsCard());
    const note = noteBox(viewName, membersFor(selection.tab));
    if (note) stack.append(note);
    if (data.state === "error") {
      const error = el("div", "ov-note");
      error.dataset.tone = "warning";
      error.append(el("strong", undefined, "workspace unavailable: "), el("span", undefined, data.error ?? "unknown host error"));
      stack.append(error);
    }
    notices.append(stack);

    // anchor pickers
    renderAnchor();

    // rows / empty state
    const members = membersFor(selection.tab);
    content.replaceChildren();
    if (data.state === "loading" && data.records.length === 0) {
      content.append(emptyState("Loading session inventory", "Waiting for the host to answer listProjects / onSessions."));
    } else if (resolved.skipped) {
      content.append(emptyState("Anchor required", resolved.skipped));
    } else if (members.length === 0) {
      content.append(emptyStateFor(viewName, data));
    } else {
      const indent = selection.tab === "tree" || selection.tab === "subtree";
      for (const session of members) content.append(renderRow(session, indent));
    }

    renderVocab();
  };

  const renderAnchor = (): void => {
    if (selection.tab !== "tree" && selection.tab !== "subtree") {
      anchorRegion.replaceChildren();
      anchorSelect?.dispose();
      anchorSelect = null;
      anchorSignature = "";
      return;
    }
    const isTree = selection.tab === "tree";
    const options = (isTree
      ? projected.filter((session) => session.isRoot)
      : projected.filter((session) => !session.isRoot)
    )
      .map((session) => ({
        id: session.id,
        label: `${session.title || "(untitled)"} · depth ${session.depth} · ${shortId(session.id)}`,
      }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    const signature = `${selection.tab}|${options.map((option) => option.id).join(",")}`;

    if (!anchorSelect || anchorSignature !== signature) {
      anchorRegion.replaceChildren();
      anchorSelect?.dispose();
      anchorSelect = null;
      const wrapper = el("div", "ov-anchor");
      wrapper.append(el("span", undefined, isTree ? "Root of the tree:" : "Anchor session of the subtree:"));
      const slot = el("div");
      wrapper.append(slot);
      anchorRegion.append(wrapper);
      anchorSelect = mountSelect(slot, {
        value: isTree ? selection.rootId : selection.subtreeId,
        options,
        placeholder: isTree ? "Choose a root session…" : "Choose a session…",
        searchable: true,
        searchPlaceholder: "Search sessions…",
        onChange: (id) => {
          if (isTree) selection.rootId = id;
          else selection.subtreeId = id;
          render();
        },
      });
      anchorSignature = signature;
    } else {
      anchorSelect.update({ value: isTree ? selection.rootId : selection.subtreeId, options });
    }
  };

  const selectTab = (tab: TabId): void => {
    selection.tab = tab;
    if (tab === "tree" && !selection.rootId) selection.rootId = defaultRootAnchor(projected);
    if (tab === "subtree" && !selection.subtreeId) selection.subtreeId = defaultSubtreeAnchor(projected);
    render();
  };

  // --- start -------------------------------------------------------------
  const stop = startWorkspace(host, (next) => {
    data = next;
    render();
  });

  host.onReady((_context: HostReadyContext) => {
    // Theme is applied by main.ts; the app only needs to exist once.
    if (!tabs) render();
  });

  render();
  return stop;
}

function emptyState(title: string, body: string): HTMLElement {
  const box = el("div", "ov-empty");
  box.append(el("strong", undefined, title), el("span", undefined, body));
  return box;
}

function emptyStateFor(viewName: string, data: WorkspaceData): HTMLElement {
  if (viewName === "needs-restart" && !data.claimEvidence) {
    return emptyState(
      "No recorded failures — and the orphan arm is unknown",
      "outcome has no failed/interrupted row, but claimed-but-idle sessions cannot be read from this host. Treat this as “no evidence”, not “zero restart candidates”.",
    );
  }
  if (viewName.startsWith("tree:") || viewName.startsWith("subtree:")) {
    return emptyState("No sessions match this anchor", "The anchor may sit outside the host's listed inventory.");
  }
  if (viewName === "question-paused") {
    return emptyState("Nothing is paused", "No session is both running and holding a pending form.");
  }
  if (viewName === "running") {
    return emptyState("Nothing is running", "No session reports a turn in flight or an execution claim.");
  }
  if (viewName === "default") {
    return emptyState("No root sessions match the proxy", "isRoot ∧ ¬fork ∧ ¬scheduled matched nothing.");
  }
  return emptyState("No sessions match this view", "Check the filter vocabulary below for what this view requires.");
}
