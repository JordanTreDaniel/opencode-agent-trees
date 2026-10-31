// Tool handlers for the `tree` namespace.
//
// Every handler is a pure-ish function over an injected dependency surface, so
// the whole tool layer is unit-testable without a live OpenCode server. The
// plugin entrypoint (`src/index.ts`) adapts `ctx` onto these deps.

import { appendEntry, readJournal, type StorageLike } from "./lib/journal.ts"
import { buildFamily, describeSelf, loadAncestors, modelLabel, type SessionLike } from "./lib/family.ts"
import { formatHandoff, outcomeWord } from "./lib/handoff.ts"

export interface TreeToolDeps {
  storage: StorageLike
  get(id: string): Promise<SessionLike | undefined>
  listChildren(parentID: string): Promise<readonly SessionLike[]>
  prompt(input: { sessionID: string; text: string; resume?: boolean | undefined }): Promise<unknown>
}

/** The subset of the tool-execution context these handlers read. */
export interface ToolCall {
  sessionID: string
  agent?: string | undefined
  messageID?: string | undefined
  id?: string | undefined
}

export interface TreeToolResult {
  /** JSON body the model reads. Tools intentionally return content only. */
  content: string
  metadata?: Record<string, unknown>
}

export interface TreeTool {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolCall): Promise<TreeToolResult>
}

const ok = (body: Record<string, unknown>): TreeToolResult => ({
  content: JSON.stringify(body, null, 2),
})

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length ? value : undefined

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
      "resuming that parent if it has already finished. Returns what the prompt call actually returned.",
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

      const outcome = outcomeWord(child.outcome)
      const text = formatHandoff({ childID, outcome, summary, ...(note ? { note } : {}) })

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

  return { whoami, family, journal, handoff, wake }
}

export const TREE_NAMESPACE = {
  name: "tree",
  description: "Agent family trees: identity, family graph, durable journals, handoff and wake.",
}
