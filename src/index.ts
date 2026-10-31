// agent-trees — OpenCode V2 server plugin.
//
// Gives agents a family tree: who am I, who is around me, what did each of my
// descendants actually do, and how do I revive a finished parent to deliver a
// result. Built on the two primitives OpenCode actually exposes:
// `Session.Info.parentID` and `ctx.session.list({ parentID })`.

import { Plugin } from "@opencode/plugin"

import { appendEntry } from "./lib/journal.ts"
import { extractChildID } from "./lib/child-dispatch.ts"
import type { SessionLike } from "./lib/family.ts"
import { createTreeTools, TREE_NAMESPACE } from "./tools.ts"

const CHILD_TOOL = /(^|_)(subagent|task|spawn)(_|$)/i

export default Plugin.define({
  id: "agent-trees",
  async setup(ctx) {
    const log = (message: string) => console.log(`[agent-trees] ${message}`)

    const get = async (id: string): Promise<SessionLike | undefined> => {
      try {
        const info = await ctx.session.get({ sessionID: id as never })
        return info as unknown as SessionLike
      } catch {
        return undefined
      }
    }

    const listChildren = async (parentID: string): Promise<readonly SessionLike[]> => {
      try {
        const page = await ctx.session.list({ parentID: parentID as never })
        return page.data as unknown as readonly SessionLike[]
      } catch {
        return []
      }
    }

    const handlers = createTreeTools({
      storage: ctx.storage,
      get,
      listChildren,
      prompt: (input) => ctx.session.prompt(input as never),
    })

    await ctx.tool.transform((editor) => {
      editor.namespace(TREE_NAMESPACE)
      for (const tool of Object.values(handlers)) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { namespace: TREE_NAMESPACE.name },
          execute: async (input, context) => {
            const result = await tool.execute(input as Record<string, unknown>, context)
            // This plugin intentionally has no output schema. Return only the
            // documented text content even if a handler grows extra internal
            // fields later; otherwise OpenCode rejects `output` without schema.
            return { content: result.content, ...(result.metadata ? { metadata: result.metadata } : {}) }
          },
        })
      }
    })

    // When a child dispatch returns, the parent gets a durable line in its own
    // journal. A killed child only returns a status string to the parent — this
    // hook is what makes "did it do nothing or 80%?" answerable afterwards.
    await ctx.tool.hook("execute.after", async (event) => {
      if (!CHILD_TOOL.test(event.tool)) return
      const base = {
        kind: "child_result",
        tool: event.tool,
        childID: extractChildID(
          event.input,
          event.status === "completed" ? event.result : event.error,
        ),
        status: event.status,
      }
      const payload =
        event.status === "error"
          ? { ...base, error: event.error?.message ?? String(event.error) }
          : { ...base, result: truncate(safeStringify(event.result), 2000) }
      await appendEntry(ctx.storage, event.sessionID as unknown as string, payload)
      log(
        `child dispatch ${event.tool} -> ${event.status}` +
          (event.status === "error" ? ` (${event.error?.message ?? "error"})` : ""),
      )
    })

    // Provider failures get written into the failing session's journal, so
    // "why did this node die" has an answer that outlives the session.
    await ctx.session.hook("retry", async (event) => {
      const error = event.error as { type?: string; message?: string; status?: number } | undefined
      await appendEntry(ctx.storage, event.sessionID as unknown as string, {
        kind: "provider_error",
        type: error?.type,
        message: error?.message,
        status: error?.status,
        attempt: event.attempt,
        retrying: event.decision.retry,
        model: `${event.model.providerID}/${event.model.id}`,
      })
    })

    log(`loaded (OpenCode ${ctx.app.version}) — tools: tree.whoami, tree.family, tree.journal, tree.handoff, tree.wake`)
  },
})

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
