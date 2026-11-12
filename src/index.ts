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
import { pauseSession, resumeSession } from "./lib/pause.ts"
import type { RecoveryListInput, RecoverSession } from "./lib/recover.ts"
import { DEFAULT_HOST, defaultDbPath, projectStatus } from "./lib/status.ts"
import { createTreeTools, TREE_NAMESPACE } from "./tools.ts"

const CHILD_TOOL = /(^|[._-])(subagent|task|spawn)([._-]|$)/i

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

    const listSessions = async (options: RecoveryListInput): Promise<{ data: readonly RecoverSession[]; cursor?: { next?: string } }> => {
      const sessions: RecoverSession[] = []
      const seenCursors = new Set<string>()
      let cursor = options.cursor
      while (true) {
        const page = await ctx.session.list({
          ...(options.parentID ? { parentID: options.parentID as never } : {}),
          ...(options.search ? { search: options.search as never } : {}),
          ...(cursor ? { cursor: cursor as never } : {}),
        })
        sessions.push(...(page.data as unknown as RecoverSession[]))
        const next = page.cursor.next
        if (!next) return { data: sessions }
        const cursorValue = String(next)
        if (seenCursors.has(cursorValue)) throw new Error(`session list repeated cursor${options.parentID ? ` for parent ${options.parentID}` : ""}`)
        seenCursors.add(cursorValue)
        cursor = cursorValue
      }
    }

    const listChildren = async (parentID: string): Promise<readonly SessionLike[]> => {
      return (await listSessions({ parentID })).data
    }

    const handlers = createTreeTools({
      storage: ctx.storage,
      get,
      listChildren,
      prompt: (input) => ctx.session.prompt(input as never),
      wait: (input) => ctx.session.wait(input as never),
      context: async (input) => (await ctx.session.context(input as never)) as never,
      switchModel: typeof ctx.session.switchModel === "function"
        ? async (input) => ctx.session.switchModel({
            sessionID: input.sessionID as never,
            model: input.model as never,
          })
        : undefined,
      listSessions,
      status: (input) =>
        projectStatus({
          ...input,
          dbPath: input.dbPath ?? defaultDbPath(),
          host: input.host ?? (process.env.OPENCHAMBER_HOST || DEFAULT_HOST),
        }),
      // Pause/resume read the environment at call time so a reconfigured host
      // or database is picked up without reloading the plugin.
      pause: (input) =>
        pauseSession({
          ...input,
          dbPath: defaultDbPath(),
          host: process.env.OPENCHAMBER_HOST || DEFAULT_HOST,
        }),
      resume: (input) =>
        resumeSession({
          ...input,
          host: process.env.OPENCHAMBER_HOST || DEFAULT_HOST,
        }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
    })

    const missingRecoveryAPIs = [
      ...(typeof ctx.session.wait === "function" ? [] : ["ctx.session.wait"]),
      ...(typeof ctx.session.context === "function" ? [] : ["ctx.session.context"]),
    ]
    const registeredHandlers = Object.values(handlers).filter((tool) => tool.name !== "recover" || missingRecoveryAPIs.length === 0)
    await ctx.tool.transform((editor) => {
      editor.namespace(TREE_NAMESPACE)
      // Keep the recovery tool off older/test contexts that do not expose the
      // V2 wait/context APIs it requires. The production V2 context has both.
      for (const tool of registeredHandlers) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          output: { type: "object", additionalProperties: true },
          options: { namespace: TREE_NAMESPACE.name },
          execute: async (input, context) => {
            const result = await tool.execute(input as Record<string, unknown>, context as never)
            return {
              content: result.content,
              output: result.output,
              ...(result.metadata ? { metadata: result.metadata } : {}),
            }
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

    // The V2 retry-policy hook runs after provider-failure classification and
    // can receive a terminal (retry:false) decision too. This is not a general
    // session-failure event: failures outside this policy hook are not captured.
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

    const registeredNames = registeredHandlers.map((tool) => `tree.${tool.name}`).join(", ")
    const omission = missingRecoveryAPIs.length ? `; tree.recover omitted (missing ${missingRecoveryAPIs.join(", ")})` : ""
    log(`loaded (OpenCode ${ctx.app.version}) — tools: ${registeredNames}${omission}`)
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
