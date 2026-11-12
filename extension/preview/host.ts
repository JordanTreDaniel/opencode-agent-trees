// Preview mock host.
//
// Runs in the preview page (NOT inside the guest iframe) and speaks the
// OpenChamber guest wire protocol — `openchamber.sdk` / `v: 1` — for the
// subset the panel uses: `hello` → `ready`, `workspace-read`,
// `workspace-subscribe` / `-unsubscribe`, `open-session`, `toast`, `resize`.
// Session data comes from ./fixtures.json, bundled below.
//
// The panel bundle itself is untouched: preview/index.html loads
// ../panel/index.html, which loads the same panel/main.js the extension
// ships. Nothing in panel/ knows this file exists.

import fixtures from "./fixtures.json";

const CHANNEL = "openchamber.sdk";
const V = 1;

interface FixtureSession {
  id: string;
  title: string;
  projectId: string;
  directory: string;
  parentId: string | null;
  createdAgoMs: number;
  updatedAgoMs: number;
  archivedAtAgoMs: number | null;
  activity: "unknown" | "idle" | "running" | "retrying" | "waiting-permission" | "waiting-question";
  outcome: "completed" | "failed" | null;
  fork?: boolean;
  scheduled?: boolean;
  claimed?: boolean;
  pendingForm?: boolean;
}

interface FixtureFile {
  projects: Array<{ id: string; name: string; directory: string }>;
  coverage: Array<{ directory: string; state: "loading" | "ready" | "error" }>;
  sessions: FixtureSession[];
}

const data = fixtures as unknown as FixtureFile;

const TOKENS = {
  background: "#0d1117",
  elevated: "#161b22",
  foreground: "#e6edf3",
  muted: "#9aa7b4",
  subtle: "#6e7b8a",
  border: "#2b3440",
  hover: "#1c2430",
  selection: "#1f3a5f",
  focus: "#4493f8",
  primary: "#2f81f7",
  mutedSurface: "#21262d",
  elevatedForeground: "#e6edf3",
  active: "#2f81f7",
  selectionForeground: "#ffffff",
  primaryForeground: "#ffffff",
  primaryText: "#4493f8",
  successText: "#56d364",
  warningText: "#e3b341",
  errorText: "#ff7b72",
  infoText: "#58a6ff",
  success: "#238636",
  warning: "#9e6a03",
  error: "#da3633",
  info: "#1f6feb",
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  radius: "8px",
};

const frame = document.getElementById("pv-frame") as HTMLIFrameElement;
const statusNode = document.getElementById("pv-status") as HTMLElement;
const toasts = document.getElementById("pv-toasts") as HTMLElement;
const provenanceInput = document.getElementById("pv-provenance") as HTMLInputElement;

/**
 * `?empty=1` — the empty-state proof fixture. It drops every session that would
 * land in `question-paused` (a live form) or `needs-restart` (a failed outcome
 * or an execution claim), so both views render their empty state against an
 * otherwise populated workspace. It changes nothing else: the other four views
 * keep their rows.
 */
const EMPTY = new URLSearchParams(window.location.search).has("empty");

const wouldPause = (session: FixtureSession): boolean =>
  session.activity === "waiting-question" || session.pendingForm === true;
const wouldRestart = (session: FixtureSession): boolean =>
  session.outcome === "failed" || session.claimed === true;

const visibleIn = (session: FixtureSession): boolean =>
  !(EMPTY && (wouldPause(session) || wouldRestart(session)));

/** The preview's one deliberate lie: supply the provenance fields the real host omits. */
let provenance = true;

interface Wire {
  channel?: string;
  v?: number;
  type: string;
  id?: string;
  payload?: unknown;
  ok?: boolean;
  error?: string;
  code?: string;
}

const subscriptions = new Map<string, { kind: string; projectId?: string }>();

const post = (message: Wire, target: Window | null = frame.contentWindow): void => {
  target?.postMessage({ channel: CHANNEL, v: V, ...message }, "*");
};

const ok = (id: string): void => post({ type: "result", id, ok: true });
const ackError = (id: string, code: string, error: string): void => post({ type: "result", id, ok: false, code, error });

const now = Date.now();

const toRecord = (fixture: FixtureSession): Record<string, unknown> => {
  const record: Record<string, unknown> = {
    id: fixture.id,
    title: fixture.title,
    projectId: fixture.projectId,
    directory: fixture.directory,
    parentId: fixture.parentId,
    createdAt: now - fixture.createdAgoMs,
    updatedAt: now - fixture.updatedAgoMs,
    archivedAt: fixture.archivedAtAgoMs === null ? null : now - fixture.archivedAtAgoMs,
    activity: fixture.activity,
    outcome: fixture.outcome,
    items: [],
  };
  if (provenance) {
    // The four fields OpenChamber 2.6.1 does not send; see fixtures.json.
    record.fork = fixture.fork === true;
    record.scheduled = fixture.scheduled === true;
    record.claimed = fixture.claimed === true;
    record.pendingForm = fixture.pendingForm === true;
  }
  return record;
};

const readyPayload = (): Wire => ({
  type: "ready",
  payload: {
    theme: { mode: "dark", tokens: TOKENS },
    locale: "en-US",
    directory: "/Users/jordanc/dev/opencode-agent-trees",
    session: null,
    surface: "page",
    connection: { connected: false, account: "" },
    settings: {},
    item: null,
  },
});

const snapshotFor = (query: { kind: string; projectId?: string }): unknown => {
  if (query.kind === "projects") {
    return { kind: "projects", state: "ready", projects: data.projects };
  }
  const projectId = query.projectId ?? "";
  const project = data.projects.find((entry) => entry.id === projectId);
  return {
    kind: "sessions",
    projectId,
    state: "ready",
    coverage: project ? data.coverage.filter((entry) => entry.directory === project.directory) : [],
    sessions: data.sessions.filter((entry) => entry.projectId === projectId && visibleIn(entry)).map(toRecord),
  };
};

const pushSnapshots = (): void => {
  for (const [subscriptionId, query] of subscriptions) {
    post({ channel: CHANNEL, v: V, type: "workspace", payload: { subscriptionId, snapshot: snapshotFor(query) } });
  }
};

const note = (text: string): void => {
  statusNode.textContent = text;
};

const toast = (message: string, kind: string): void => {
  const node = document.createElement("div");
  node.className = `pv-toast pv-toast-${kind}`;
  node.textContent = message;
  toasts.append(node);
  window.setTimeout(() => node.remove(), 3200);
};

const handle = (message: Wire): void => {
  const id = message.id;
  switch (message.type) {
    case "hello":
      post(readyPayload());
      note("hello → ready (surface: page)");
      return;
    case "workspace-read": {
      if (!id) return;
      post({ type: "result", id, ok: true, payload: snapshotFor(message.payload as { kind: string; projectId?: string }) });
      note(`workspace-read ${(message.payload as { kind: string }).kind}`);
      return;
    }
    case "workspace-subscribe": {
      if (!id) return;
      const payload = message.payload as { subscriptionId: string; query: { kind: string; projectId?: string } };
      subscriptions.set(payload.subscriptionId, payload.query);
      ok(id);
      post({ channel: CHANNEL, v: V, type: "workspace", payload: { subscriptionId: payload.subscriptionId, snapshot: snapshotFor(payload.query) } });
      note(`workspace-subscribe ${payload.query.projectId ?? payload.query.kind}`);
      return;
    }
    case "workspace-unsubscribe": {
      if (!id) return;
      const payload = message.payload as { subscriptionId: string };
      subscriptions.delete(payload.subscriptionId);
      ok(id);
      return;
    }
    case "open-session": {
      if (!id) return;
      ok(id);
      const sessionId = (message.payload as { sessionId: string }).sessionId;
      note(`open-session ${sessionId}`);
      toast(`openSession(${sessionId}) → acknowledged by the mock host`, "info");
      return;
    }
    case "toast": {
      if (!id) return;
      ok(id);
      const payload = message.payload as { message: string; kind: string };
      toast(payload.message, payload.kind);
      return;
    }
    case "close":
    case "resize":
      if (id) ok(id);
      return;
    default:
      if (id) ackError(id, "UNSUPPORTED", `${message.type} is not implemented by the preview mock host`);
      note(`rejected ${message.type} (UNSUPPORTED)`);
  }
};

// Queue anything that arrives before the module finished initialising; the
// panel posts `hello` as soon as its own script runs.
const pending: Wire[] = [];
let installed = false;

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as Wire | null;
  if (!message || message.channel !== CHANNEL || message.v !== V) return;
  if (!installed) {
    pending.push(message);
    return;
  }
  handle(message);
});

provenanceInput.addEventListener("change", () => {
  provenance = provenanceInput.checked;
  pushSnapshots();
  note(`provenance fields ${provenance ? "supplied" : "stripped"} → snapshots re-pushed`);
});

installed = true;
for (const message of pending.splice(0)) handle(message);
note(
  EMPTY
    ? "mock host ready — ?empty=1: needs-restart + question-paused forced empty"
    : "mock host ready — waiting for the panel's hello",
);

// The panel frame loads after this script, so a stray `hello` from a previous
// navigation is re-answered on frame load.
frame.addEventListener("load", () => {
  note("panel frame loaded");
});
