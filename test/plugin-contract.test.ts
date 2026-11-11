import test from "node:test"
import assert from "node:assert/strict"

import plugin from "../src/index.ts"
import { readJournal } from "../src/lib/journal.ts"
import { makeFakeCtx, seedFamily } from "./fake-ctx.ts"
import { writeSessionDb } from "./status-fixture.ts"

async function registerTools(
  fixture: ReturnType<typeof makeFakeCtx>,
  list: (input: { parentID?: string; cursor?: string }) => Promise<{ data: Array<{ id: string; parentID?: string }>; cursor?: { next?: string | null } }>,
) {
  const registered: Array<Record<string, unknown>> = []
  const hooks = new Map<string, (event: Record<string, unknown>) => Promise<void> | void>()
  const context = {
    app: { version: "2.1.2" },
    storage: fixture.storage,
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        const session = fixture.get(sessionID)
        if (!session) throw new Error(`session not found: ${sessionID}`)
        return session
      },
      list,
      prompt: async (input: { sessionID: string; text: string; resume?: boolean }) => ({ ...input }),
      hook: async (name: string, callback: (event: Record<string, unknown>) => Promise<void> | void) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
    tool: {
      transform: async (callback: (editor: { namespace(): void; add(tool: Record<string, unknown>): void }) => void) => {
        callback({ namespace() {}, add(tool) { registered.push(tool) } })
      },
      hook: async (name: string, callback: (event: Record<string, unknown>) => Promise<void> | void) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
  }

  await plugin.setup(context as never)
  return { registered, hooks }
}

test("all registered tree tools declare and return the V2 structured-output contract", async () => {
  const fixture = makeFakeCtx()
  seedFamily(fixture, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_child: { parentID: "ses_root", agent: "general", title: "child" },
  })
  const { registered } = await registerTools(fixture, async () => ({ data: [], cursor: {} }))

  assert.deepEqual(
    registered.map((tool) => tool.name).sort(),
    ["family", "handoff", "journal", "status", "wake", "whoami"],
  )

  const inputs: Record<string, Record<string, unknown>> = {
    whoami: {},
    family: {},
    journal: { action: "read" },
    handoff: { childID: "ses_child", summary: "finished" },
    wake: { sessionID: "ses_root", text: "wake" },
    status: { view: "default" },
  }
  const caller = { sessionID: "ses_root", agent: "orchestrator", messageID: "msg_test", id: "call_test" }

  // tree.status reads the session database and the host. Point both at a
  // throwaway fixture so this contract test stays hermetic and proves the
  // documented degradation path instead of depending on a live machine.
  const database = writeSessionDb([{ id: "ses_statusroot", created: 1, updated: 2, outcome: "succeeded" }])
  const previousDb = process.env.OPENCODE_DB
  const previousHost = process.env.OPENCHAMBER_HOST
  process.env.OPENCODE_DB = database.path
  process.env.OPENCHAMBER_HOST = "http://127.0.0.1:1"
  try {
    for (const tool of registered) {
      assert.deepEqual(tool.output, { type: "object", additionalProperties: true }, `${String(tool.name)} output schema`)
      const result = await (tool.execute as (input: Record<string, unknown>, context: typeof caller) => Promise<Record<string, unknown>>)(
        inputs[String(tool.name)]!,
        caller,
      )
      assert.equal(typeof result.content, "string", `${String(tool.name)} content`)
      assert.ok(result.output && typeof result.output === "object", `${String(tool.name)} structured output`)
      if (tool.name === "status") {
        const status = result.output as { sessions: unknown[]; meta: { stale: boolean; view: string } }
        assert.equal(status.meta.view, "default")
        assert.equal(status.meta.stale, true, "an unreachable host degrades to a DB-only projection")
        assert.deepEqual(status.sessions.map((session) => (session as { id: string }).id), ["ses_statusroot"])
      }
    }
  } finally {
    if (previousDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = previousDb
    if (previousHost === undefined) delete process.env.OPENCHAMBER_HOST
    else process.env.OPENCHAMBER_HOST = previousHost
    database.cleanup()
  }
})

test("tree_family follows session-list cursors and includes children from every page", async () => {
  const fixture = makeFakeCtx()
  seedFamily(fixture, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_first: { parentID: "ses_root", agent: "general", title: "first" },
    ses_second: { parentID: "ses_root", agent: "general", title: "second" },
    ses_unrelated: { parentID: "ses_other", agent: "general", title: "unrelated" },
  })
  const requests: Array<{ parentID?: string; cursor?: string }> = []
  const { registered } = await registerTools(fixture, async (input) => {
    requests.push(input)
    if (input.cursor === "children-next") {
      const data = input.parentID === "ses_root"
        ? [fixture.get("ses_second")!]
        : [fixture.get("ses_second")!, fixture.get("ses_unrelated")!]
      return { data, cursor: {} }
    }
    if (input.parentID === "ses_root") {
      return { data: [fixture.get("ses_first")!], cursor: { next: "children-next" } }
    }
    return { data: [], cursor: {} }
  })

  const family = registered.find((tool) => tool.name === "family")!
  const result = await (family.execute as (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<{ content: string }>)
    ({ sessionID: "ses_root" }, { sessionID: "ses_root" })
  const body = JSON.parse(result.content) as { tree: { children: Array<{ sessionID: string }> } }

  assert.deepEqual(body.tree.children.map((child) => child.sessionID), ["ses_first", "ses_second"])
  assert.deepEqual(requests.filter((request) => request.parentID === "ses_root" || request.cursor === "children-next"), [
    { parentID: "ses_root" },
    { parentID: "ses_root", cursor: "children-next" },
  ])
})

test("tree_family surfaces session-list errors instead of returning an empty family", async () => {
  const fixture = makeFakeCtx()
  seedFamily(fixture, { ses_root: { agent: "orchestrator", title: "root" } })
  const { registered } = await registerTools(fixture, async (input) => {
    if (input.parentID === "ses_root") throw new Error("list transport failed")
    return { data: [], cursor: {} }
  })
  const family = registered.find((tool) => tool.name === "family")!

  await assert.rejects(
    () => (family.execute as (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>)
      ({ sessionID: "ses_root" }, { sessionID: "ses_root" }),
    /list transport failed/,
  )
})

test("execute.after handles documented completed/error events and extracts child IDs from each payload", async () => {
  const fixture = makeFakeCtx()
  const { hooks } = await registerTools(fixture, async () => ({ data: [], cursor: {} }))
  const after = hooks.get("execute.after")!

  await after({
    tool: "opencode.tool.subagent",
    sessionID: "ses_root",
    agent: "orchestrator",
    messageID: "msg_completed",
    id: "call_completed",
    input: { task: "do work" },
    status: "completed",
    result: {
      output: { sessionID: "ses_completed" },
      content: [{ type: "text", text: "created child ses_completed" }],
    },
  })
  await after({
    tool: "opencode.tool.subagent",
    sessionID: "ses_root",
    agent: "orchestrator",
    messageID: "msg_error",
    id: "call_error",
    input: { task: "fail" },
    status: "error",
    error: { message: "child session ses_failed exited" },
  })

  const entries = await readJournal(fixture.storage, "ses_root")
  assert.deepEqual(entries.map((entry) => [entry.status, entry.childID]), [
    ["completed", "ses_completed"],
    ["error", "ses_failed"],
  ])
})

test("session.retry journals an emitted terminal provider decision without claiming a universal failure hook", async () => {
  const fixture = makeFakeCtx()
  const { hooks } = await registerTools(fixture, async () => ({ data: [], cursor: {} }))
  const retry = hooks.get("retry")!

  await retry({
    sessionID: "ses_root",
    agent: "orchestrator",
    model: { providerID: "local-test", id: "fixture" },
    error: { type: "provider.usage-limit", message: "usage limit", status: 402 },
    attempt: 3,
    decision: { retry: false },
  })

  const [entry] = await readJournal(fixture.storage, "ses_root")
  assert.equal(entry.kind, "provider_error")
  assert.equal(entry.retrying, false)
  assert.equal(entry.attempt, 3)
  assert.equal(entry.model, "local-test/fixture")
})
