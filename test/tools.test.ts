import test from "node:test"
import assert from "node:assert/strict"

import { createTreeTools } from "../src/tools.ts"
import { readJournal } from "../src/lib/journal.ts"
import { makeFakeCtx, seedFamily } from "./fake-ctx.ts"

function harness() {
  const calls: Array<{ sessionID: string; text: string; resume?: boolean | undefined }> = []
  const ctx = makeFakeCtx()
  const deps = {
    storage: ctx.storage,
    get: ctx.deps.get,
    listChildren: ctx.deps.listChildren,
    prompt: async (input: { sessionID: string; text: string; resume?: boolean | undefined }) => {
      calls.push(input)
      return { id: "msg_fake", sessionID: input.sessionID, type: "user" }
    },
  }
  const tools = createTreeTools(deps)
  return { ctx, tools, calls }
}

const caller = { sessionID: "ses_caller", agent: "general", messageID: "msg_1", id: "call_1" }

test("tree_whoami reads the CALLING session id from the tool context", async () => {
  const { ctx, tools } = harness()
  seedFamily(ctx, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_caller: { parentID: "ses_root", agent: "general", title: "me" },
  })
  const result = await tools.whoami.execute({}, caller)
  const out = JSON.parse(result.content) as Record<string, unknown>
  assert.equal(out.sessionID, "ses_caller")
  assert.equal(out.parentID, "ses_root")
  assert.equal(out.rootID, "ses_root")
  assert.equal(out.depth, 1)
  assert.equal(out.agent, "general")
})

test("tree_journal append defaults to the calling session, read returns it back", async () => {
  const { ctx, tools } = harness()
  seedFamily(ctx, { ses_caller: { agent: "general", title: "me" } })

  await tools.journal.execute({ action: "append", entry: "started", metadata: { phase: 1 } }, caller)
  const read = (await tools.journal.execute({ action: "read" }, caller)) as { content: string }
  const entries = (JSON.parse(read.content) as { entries: Array<Record<string, unknown>> }).entries
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.entry, "started")
  assert.deepEqual(entries[0]!.metadata, { phase: 1 })
})

test("tree_handoff sends a concise provenance report to the child's actual parent", async () => {
  const { ctx, tools, calls } = harness()
  seedFamily(ctx, {
    ses_parent: { agent: "orchestrator", title: "parent", outcome: "succeeded" },
    ses_dead: { parentID: "ses_parent", agent: "general", title: "dead child", outcome: "failed" },
  })

  const result = (await tools.handoff.execute(
    { childID: "ses_dead", summary: "Go usage limit exceeded", note: "pin the model" },
    { ...caller, sessionID: "ses_parent" },
  )) as { content: string }
  const out = JSON.parse(result.content) as Record<string, unknown>

  const journal = await readJournal(ctx.storage, "ses_dead")
  assert.equal(journal.length, 1)
  assert.equal(journal[0]!.kind, "handoff")
  assert.equal(journal[0]!.summary, "Go usage limit exceeded")

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.sessionID, "ses_parent")
  assert.equal(calls[0]!.resume, true)
  assert.equal(
    calls[0]!.text,
    "Agent-tree handoff from ses_parent: child ses_dead (parent ses_parent) died. Here is what it reported: Go usage limit exceeded. Note: pin the model.",
  )
  assert.equal(out.target, "ses_parent")
  assert.deepEqual(out.prompt, { id: "msg_fake", sessionID: "ses_parent", type: "user" })
})

test("tree_handoff allows tree-wide descendants but rejects sessions from another family", async () => {
  const { ctx, tools, calls } = harness()
  seedFamily(ctx, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_parent: { parentID: "ses_root", agent: "general", title: "parent" },
    ses_child: { parentID: "ses_parent", agent: "general", title: "child", outcome: "succeeded" },
    ses_other_root: { agent: "orchestrator", title: "other root" },
    ses_other_child: { parentID: "ses_other_root", agent: "general", title: "unrelated" },
  })

  await tools.handoff.execute(
    { childID: "ses_child", summary: "nested work complete" },
    { ...caller, sessionID: "ses_root" },
  )
  assert.equal(calls[0]!.sessionID, "ses_parent")

  await assert.rejects(
    () => tools.handoff.execute(
      { childID: "ses_other_child", summary: "not ours" },
      { ...caller, sessionID: "ses_root" },
    ),
    /outside the caller's session family/i,
  )
  assert.equal(calls.length, 1)
})

test("tree_handoff refuses a session with no parent instead of guessing a target", async () => {
  const { ctx, tools, calls } = harness()
  seedFamily(ctx, { ses_orphan: { agent: "general", title: "orphan" } })
  await assert.rejects(
    async () => tools.handoff.execute({ childID: "ses_orphan", summary: "x" }, caller),
    /no parent/i,
  )
  assert.equal(calls.length, 0)
})

test("tree_wake forwards text and resume to ctx.session.prompt", async () => {
  const { ctx, tools, calls } = harness()
  seedFamily(ctx, { ses_sleeper: { agent: "general", title: "sleeper", outcome: "succeeded" } })
  const woken = (await tools.wake.execute({ sessionID: "ses_sleeper", text: "continue" }, caller)) as {
    content: string
  }
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.sessionID, "ses_sleeper")
  assert.equal(calls[0]!.resume, true)
  assert.equal((JSON.parse(woken.content) as Record<string, unknown>).sessionID, "ses_sleeper")
})

test("tree_recover declares excludeSessionIds and passes a cleaned exclusion list through to recovery", async () => {
  const ctx = makeFakeCtx()
  const sessions = new Map<string, Record<string, unknown>>([
    ["ses_root", { id: "ses_root", title: "root", outcome: "failed" }],
    ["ses_stale", { id: "ses_stale", parentID: "ses_root", title: "stale", outcome: "failed" }],
    ["ses_fresh", { id: "ses_fresh", parentID: "ses_root", title: "fresh", outcome: "failed" }],
  ])
  const messages = new Map<string, Array<Record<string, unknown>>>([...sessions.keys()].map((id) => [id, []]))
  const prompted: string[] = []
  let admission = 0

  const tools = createTreeTools({
    storage: ctx.storage,
    get: async (id) => sessions.get(id) as never,
    listChildren: async (parentID) => [...sessions.values()].filter((session) => session.parentID === parentID) as never,
    listSessions: async (input) => ({
      data: (input.parentID
        ? [...sessions.values()].filter((session) => session.parentID === input.parentID)
        : [...sessions.values()]) as never,
    }),
    prompt: async (input) => {
      prompted.push(input.sessionID)
      const id = `adm-${++admission}`
      messages.get(input.sessionID)!.push({ id, role: "user", parts: [{ type: "text", text: input.text }] })
      return { id, sessionID: input.sessionID }
    },
    wait: async ({ sessionID }) => {
      const inbox = messages.get(sessionID)!
      const lastUser = [...inbox].reverse().find((message) => message.role === "user")
      if (lastUser) inbox.push({ id: `ans-${inbox.length}`, role: "assistant", finish: "stop", parts: [{ type: "text", text: `done in ${sessionID}` }] })
    },
    context: async ({ sessionID }) => messages.get(sessionID) ?? [],
    sleep: async () => {},
    now: Date.now,
  })

  const schema = tools.recover.input.properties as Record<string, { type?: string; items?: { type?: string } }>
  assert.equal(schema.excludeSessionIds?.type, "array")
  assert.equal(schema.excludeSessionIds?.items?.type, "string")

  const result = await tools.recover.execute(
    { rootId: "ses_root", excludeSessionIds: ["ses_stale", " ", "ses_stale", 42] },
    caller,
  )
  const output = result.output as {
    actions: Array<{ sessionID: string; action: string }>
    stats: { skippedSuperseded: number }
    rootReactivated: boolean
  }
  // Empty strings, duplicates, and non-strings are dropped before recovery.
  assert.deepEqual(prompted.filter((sessionID) => sessionID === "ses_stale"), [])
  assert.equal(output.actions.find((action) => action.sessionID === "ses_stale")?.action, "skipped-superseded")
  assert.equal(output.stats.skippedSuperseded, 1)
  assert.equal(output.rootReactivated, true)
})
