// Tool handlers for the `tree` namespace.
//
// Every handler is a pure-ish function over an injected dependency surface, so
// the whole tool layer is unit-testable without a live OpenCode server. The
// plugin entrypoint (`src/index.ts`) adapts `ctx` onto these deps.

import { appendEntry, readJournal, type StorageLike } from "./lib/journal.ts"
import { buildFamily, describeSelf, loadAncestors, modelLabel, type SessionLike } from "./lib/family.ts"
import { formatHandoff, outcomeWord } from "./lib/handoff.ts"
import { recoverSessions, type RecoverSession, type RecoveryListInput, type RecoveryPrompt } from "./lib/recover.ts"
import type { PauseResult, ResumeResult } from "./lib/pause.ts"
import type { ProjectStatusInput, StatusProjection } from "./lib/status.ts"

export interface TreeToolDeps {
  storage: StorageLike
  get(id: string): Promise<SessionLike | undefined>
  listChildren(parentID: string): Promise<readonly SessionLike[]>
  prompt(input: { sessionID: string; text: string; resume?: boolean | undefined; delivery?: "steer" | "queue" | undefined }): Promise<unknown>
  wait?(input: { sessionID: string }): Promise<void>
  context?(input: { sessionID: string }): Promise<readonly import("./lib/recover.ts").RecoveryMessage[]>
  switchModel?(input: { sessionID: string; model: { providerID: string; id: string } }): Promise<void>
  listSessions?(input: RecoveryListInput): Promise<{ data: readonly RecoverSession[]; cursor?: { next?: string } }>
  /** Status/views projection. Supplied by the plugin entrypoint, which owns the DB path and host. */
  status?(input: ProjectStatusInput): Promise<StatusProjection>
  /** Pause one session (prompt injection + verification). Supplied by the plugin entrypoint. */
  pause?(input: { sessionId: string; question: string; defaultAnswer?: string | null; timeoutMs?: number; treeRoot?: string | null }): Promise<PauseResult>
  /** Reply to a paused form and verify the session leaves question-paused. */
  resume?(input: { sessionId: string; formId: string; answer: string }): Promise<ResumeResult>
  sleep?(ms: number): Promise<void>
  now?(): number
}

/** Rows a single `tree.status` call may put in the transcript. */
const MAX_TOOL_SESSIONS = 200

/** The subset of the tool-execution context these handlers read. */
export interface ToolCall {
  sessionID: string
  agent?: string | undefined
  messageID?: string | undefined
  id?: string | undefined
  signal?: AbortSignal | undefined
  progress?: ((update: unknown) => void | Promise<void>) | undefined
}

export interface TreeToolResult {
  /** Human-readable rendering for the tool transcript. */
  content: string
  /** Structured body for the OpenCode V2 tool output schema. */
  output: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface TreeTool {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolCall): Promise<TreeToolResult>
}

const ok = (body: Record<string, unknown>): TreeToolResult => {
  // Match the declared JSON object output schema and omit undefined fields just
  // as JSON serialization does for the text rendering.
  const output = JSON.parse(JSON.stringify(body)) as Record<string, unknown>
  return { content: JSON.stringify(output, null, 2), output }
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length ? value : undefined

/** Trim, drop empties, and dedupe a string-array input; undefined when nothing usable remains. */
const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const items = [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))]
  return items.length ? items : undefined
}

export function createTreeTools(deps: TreeToolDeps): Record<string, TreeTool> {
  const whoami: TreeTool = {
    name: "whoami",
    description:
      "Return this session's own identity: sessionID, agent, title, parentID, rootID and depth. " +
      "Reads the calling session id from the tool context, never from the environment.",
    input: { type: "object", properties: {}, additionalProperties: false },
    async execute(_input, context) {
      const cache = await loadAncestors(context.sessionID, deps)
      const self = describeSelf(context.sessionID, (id) => cache.get(id))
      const own = cache.get(context.sessionID)
      return ok({
        sessionID: self.sessionID,
        agent: self.agent ?? context.agent,
        title: self.title,
        parentID: self.parentID,
        rootID: self.rootID,
        depth: self.depth,
        model: own ? modelLabel(own) : undefined,
        outcome: own?.outcome,
      })
    },
  }

  const family: TreeTool = {
    name: "family",
    description:
      "Return the agent family tree around a session: walks parentID up to the root, then lists children " +
      "down, so parents, siblings and cousins are all visible with their agent, model and outcome.",
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string", description: "Session to center the tree on. Defaults to the caller." },
        includeSelf: {
          type: "boolean",
          description: "When false, start at the given session and show only its children. Default true.",
        },
        maxNodes: { type: "integer", minimum: 1, maximum: 2000, description: "Node budget. Default 200." },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      const sessionID = asString(input.sessionID) ?? context.sessionID
      const tree = await buildFamily(
        {
          sessionID,
          includeSelf: typeof input.includeSelf === "boolean" ? input.includeSelf : undefined,
          maxNodes: typeof input.maxNodes === "number" ? input.maxNodes : undefined,
        },
        deps,
      )
      return ok({ ...tree })
    },
  }

  const journal: TreeTool = {
    name: "journal",
    description:
      "Durable per-session ledger. action=append writes one entry into journal:<sessionID>; action=read returns " +
      "every entry. Entries survive the session dying — this is the record a parent can rely on.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["append", "read"] },
        sessionID: { type: "string", description: "Defaults to the calling session." },
        entry: { type: "string", description: "Required for action=append." },
        metadata: { type: "object", description: "Optional structured payload stored with the entry." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const action = asString(input.action)
      if (action !== "append" && action !== "read") throw new Error(`unknown action: ${String(input.action)}`)
      const sessionID = asString(input.sessionID) ?? context.sessionID
      if (action === "read") {
        const entries = await readJournal(deps.storage, sessionID)
        return ok({ sessionID, count: entries.length, entries })
      }
      const entry = asString(input.entry)
      if (!entry) throw new Error("entry is required when action=append")
      const metadata =
        input.metadata && typeof input.metadata === "object" ? (input.metadata as Record<string, unknown>) : undefined
      const record = await appendEntry(deps.storage, sessionID, {
        kind: "note",
        entry,
        ...(metadata ? { metadata } : {}),
        author: context.sessionID,
      })
      return ok({ sessionID, appended: record })
    },
  }

  const handoff: TreeTool = {
    name: "handoff",
    description:
      "Record a child's report in its journal, then push a formatted handoff into the child's parent session, " +
      "only when the child belongs to the caller's session family. The actual parent is resumed if finished.",
    input: {
      type: "object",
      properties: {
        childID: { type: "string", description: "The session whose result is being handed off." },
        summary: { type: "string", description: "What the child reported." },
        note: { type: "string", description: "Optional extra guidance for the parent." },
      },
      required: ["childID", "summary"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const childID = asString(input.childID)
      const summary = asString(input.summary)
      if (!childID) throw new Error("childID is required")
      if (!summary) throw new Error("summary is required")
      const note = asString(input.note)

      const child = await deps.get(childID)
      if (!child) throw new Error(`session not found: ${childID}`)
      const parentID = child.parentID
      if (!parentID) throw new Error(`session ${childID} has no parent to hand off to`)

      const [childAncestors, callerAncestors] = await Promise.all([
        loadAncestors(childID, deps),
        loadAncestors(context.sessionID, deps),
      ])
      if (!childAncestors.has(childID)) throw new Error(`session not found: ${childID}`)
      if (!callerAncestors.has(context.sessionID)) throw new Error(`session not found: ${context.sessionID}`)
      const childRoot = describeSelf(childID, (id) => childAncestors.get(id)).rootID
      const callerRoot = describeSelf(context.sessionID, (id) => callerAncestors.get(id)).rootID
      if (childRoot !== callerRoot) throw new Error(`session ${childID} is outside the caller's session family`)

      const outcome = outcomeWord(child.outcome)
      const text = formatHandoff({
        reporterID: context.sessionID,
        childID,
        parentID,
        outcome,
        summary,
        ...(note ? { note } : {}),
      })

      await appendEntry(deps.storage, childID, {
        kind: "handoff",
        outcome,
        summary,
        ...(note ? { note } : {}),
        to: parentID,
        author: context.sessionID,
      })

      const prompt = await deps.prompt({ sessionID: parentID, text, resume: true })

      await appendEntry(deps.storage, parentID, {
        kind: "handoff_received",
        childID,
        outcome,
        summary,
        text,
        author: context.sessionID,
      })

      return ok({ childID, target: parentID, outcome, text, prompt })
    },
  }

  const wake: TreeTool = {
    name: "wake",
    description:
      "Send text into any session via ctx.session.prompt, resuming it when it has finished. Thin wrapper used " +
      "to revive a stalled or finished node.",
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string" },
        text: { type: "string" },
        resume: { type: "boolean", description: "Default true." },
      },
      required: ["sessionID", "text"],
      additionalProperties: false,
    },
    async execute(input) {
      const sessionID = asString(input.sessionID)
      const text = asString(input.text)
      if (!sessionID) throw new Error("sessionID is required")
      if (!text) throw new Error("text is required")
      const resume = input.resume === false ? false : true
      const prompt = await deps.prompt({ sessionID, text, resume })
      return ok({ sessionID, resume, text, prompt })
    },
  }

  const recover: TreeTool = {
    name: "recover",
    description:
      "Recursively recover one session tree bottom-up. rootId accepts any session ID in the tree and climbs to the true root. If rootId is omitted, optional NRR/custom-marker discovery proceeds only when exactly one title matches. Supports dry-run planning.",
    input: {
      type: "object",
      properties: {
        rootId: { type: "string", description: "Any session ID in the tree; recovery climbs parentID links to the true root. Omit for optional title-marker discovery." },
        marker: { type: "string", description: "Title marker for discovery when rootId is omitted. Default nrr; bare and parenthesized forms are accepted." },
        dryRun: { type: "boolean", description: "Return the complete recovery plan without sending prompts." },
        leafTimeoutMs: { type: "integer", minimum: 1, description: "Maximum wait per resumed session. Default 900000." },
        maxDurationMs: { type: "integer", minimum: 1, description: "Maximum total run duration. Default 3600000." },
        pinModel: { type: "string", description: "Optionally pin resumed sessions to providerID/modelID. Omit to preserve each session's current model." },
        excludeSessionIds: {
          type: "array",
          items: { type: "string" },
          description: "Session IDs to leave untouched (superseded batches). Excluded failed/interrupted/unknown sessions receive no prompt and no model switch and count as already-complete for sibling barriers. Omit to recover the whole tree.",
        },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      if (!deps.listSessions || !deps.wait || !deps.context) {
        throw new Error("tree.recover requires listSessions, wait, and context dependencies")
      }
      const rootId = asString(input.rootId)
      const excludeSessionIds = asStringArray(input.excludeSessionIds)
      const report = await recoverSessions(
        {
          ...(rootId ? { rootId } : {}),
          ...(asString(input.marker) ? { marker: asString(input.marker) } : {}),
          ...(typeof input.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
          ...(typeof input.leafTimeoutMs === "number" ? { leafTimeoutMs: input.leafTimeoutMs } : {}),
          ...(typeof input.maxDurationMs === "number" ? { maxDurationMs: input.maxDurationMs } : {}),
          ...(asString(input.pinModel) ? { pinModel: asString(input.pinModel) } : {}),
          ...(excludeSessionIds ? { excludeSessionIds } : {}),
          ...(context.signal ? { signal: context.signal } : {}),
          ...(context.progress ? { progress: context.progress } : {}),
        },
        {
          storage: deps.storage,
          get: async (id) => (await deps.get(id)) as RecoverSession | undefined,
          listSessions: deps.listSessions,
          prompt: (prompt) => deps.prompt(prompt as RecoveryPrompt),
          wait: deps.wait,
          context: deps.context,
          switchModel: deps.switchModel,
          sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
          now: deps.now ?? Date.now,
        },
      )
      return ok(report as unknown as Record<string, unknown>)
    },
  }

  const status: TreeTool = {
    name: "status",
    description:
      "Filtered projection over the session views. Answers \"which sessions are running, paused on a question, or restart " +
      "candidates\" from the session database merged with the host's live running set and pending forms. `sessions` lists the " +
      "rows of the selected view; `meta.scanned` reports how much of the inventory was read. userSpawned and waveIndex have no " +
      "source and are reported under meta.unavailable rather than guessed.",
    input: {
      type: "object",
      properties: {
        view: {
          type: "string",
          description:
            "default | running | needs-restart | question-paused | tree:<rootId> | subtree:<id>. Default `default` " +
            "(a documented proxy for a user-started conversation: root and not a fork and not scheduled).",
        },
        rootId: { type: "string", description: "Bind the tree view to a root session. Also accepts any session id." },
        subtreeOf: { type: "string", description: "Bind the subtree view to a session; self-inclusive." },
        limit: { type: "integer", minimum: 1, description: "Inventory cap. Default 2000." },
      },
      additionalProperties: false,
    },
    async execute(input) {
      if (!deps.status) throw new Error("tree.status requires a status projection dependency")
      const view = asString(input.view)
      const projection = await deps.status({
        ...(view ? { view } : {}),
        ...(asString(input.rootId) ? { rootId: asString(input.rootId) } : {}),
        ...(asString(input.subtreeOf) ? { subtreeOf: asString(input.subtreeOf) } : {}),
        ...(typeof input.limit === "number" ? { limit: Math.max(1, Math.trunc(input.limit)) } : {}),
      })

      const selectedName = projection.meta.view
      const membership = projection.views[selectedName] ?? { count: 0, ids: [] }
      if (membership.skipped) throw new Error(`${selectedName}: ${membership.skipped}`)
      const wanted = new Set(membership.ids ?? [])
      const rows = projection.sessions.filter((session) => wanted.has(session.id))
      const shown = rows.slice(0, MAX_TOOL_SESSIONS)

      // Counts only for the other views: the ids are already implied by `sessions`.
      const viewSummary: Record<string, unknown> = {}
      for (const [name, entry] of Object.entries(projection.views)) {
        viewSummary[name] = {
          count: entry.count,
          ...(entry.skipped ? { skipped: entry.skipped } : {}),
          ...(entry.isProxy ? { isProxy: true } : {}),
          ...(entry.note ? { note: entry.note } : {}),
        }
      }

      return ok({
        view: selectedName,
        sessions: shown,
        views: viewSummary,
        meta: {
          ...projection.meta,
          rowCount: rows.length,
          ...(shown.length < rows.length
            ? { omittedRows: rows.length - shown.length, omitNote: `rows beyond the first ${MAX_TOOL_SESSIONS} are omitted from this response; use scripts/tree-status.mjs --json for the full set` }
            : {}),
        },
      })
    },
  }

  const pause: TreeTool = {
    name: "pause",
    description:
      "Pause another session. Pause is PROMPT INJECTION, not an API: it sends the target a prompt instructing the `question` " +
      "tool, then polls the host until a NEW pending form AND the execution claim are both observed before reporting `paused`. " +
      "`ignored` means the model did not call the question tool — a prompt was delivered, nothing was held. sessionID is " +
      "required (a session cannot pause its own in-flight turn). The verified pause is recorded under the data dir's " +
      "pauses/<sessionID>.json so tree.resume can find it after an engine restart.",
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string", description: "Session to pause. Required." },
        question: { type: "string", description: "The one question the paused session must ask through the question tool." },
        defaultAnswer: { type: "string", description: "Intended answer stored in the pause record for a later resume." },
        timeoutMs: { type: "integer", minimum: 1, description: "Wait for form + claim to appear. Default 120000." },
      },
      required: ["sessionID", "question"],
      additionalProperties: false,
    },
    async execute(input) {
      if (!deps.pause) throw new Error("tree.pause requires a pause dependency")
      const sessionID = asString(input.sessionID)
      const question = asString(input.question)
      if (!sessionID) throw new Error("sessionID is required")
      if (!question) throw new Error("question is required")
      // Walk to the true root so the durable record carries the tree anchor.
      const cache = await loadAncestors(sessionID, deps)
      const treeRoot = describeSelf(sessionID, (id) => cache.get(id)).rootID ?? null
      const defaultAnswer = asString(input.defaultAnswer)
      const result = await deps.pause({
        sessionId: sessionID,
        question,
        ...(defaultAnswer ? { defaultAnswer } : {}),
        ...(typeof input.timeoutMs === "number" ? { timeoutMs: Math.max(1, Math.trunc(input.timeoutMs)) } : {}),
        treeRoot,
      })
      return ok({ sessionID, ...result })
    },
  }

  const resume: TreeTool = {
    name: "resume",
    description:
      "Reply to a paused session's pending form. The reply resolves the engine's Deferred, so the SAME turn continues: " +
      "deterministic, no new prompt, no second billing. Reports `resumed` only after the form leaves the host's pending set " +
      "(the session left question-paused). `stale-form` means the form died — pending forms live in engine RAM — and coming " +
      "back needs a NEW paid turn (tree.wake), not a reply.",
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string", description: "The paused session. Required." },
        formId: { type: "string", description: "Pending form id, from tree.pause or the host's /api/sessions/status." },
        answer: { type: "string", description: "Answer delivered to every field of the form." },
      },
      required: ["sessionID", "formId", "answer"],
      additionalProperties: false,
    },
    async execute(input) {
      if (!deps.resume) throw new Error("tree.resume requires a resume dependency")
      const sessionID = asString(input.sessionID)
      const formId = asString(input.formId)
      const answer = asString(input.answer)
      if (!sessionID) throw new Error("sessionID is required")
      if (!formId) throw new Error("formId is required")
      if (!answer) throw new Error("answer is required")
      const result = await deps.resume({ sessionId: sessionID, formId, answer })
      return ok({ sessionID, formId, ...result })
    },
  }

  return { whoami, family, journal, handoff, wake, recover, status, pause, resume }
}

export const TREE_NAMESPACE = {
  name: "tree",
  description:
    "Agent family trees: identity, family graph, durable journals, handoff, wake, recovery, status views, and pause/resume.",
}
