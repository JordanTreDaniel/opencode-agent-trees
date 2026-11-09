import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import type { SessionMessageInfo } from "@opencode/client"

import { classifyFailure, DIAGNOSTIC_TIMEOUT_MS, normalizeRecoveryMessage, RECOVERY_DIAGNOSTIC, recoverSessions, type RecoverSession, type RecoveryMessage, type RecoveryPrompt } from "../src/lib/recover.ts"
import { makeFakeStorage } from "./fake-ctx.ts"

interface HarnessOptions {
  sessions: Record<string, Omit<RecoverSession, "id">>
  children?: Record<string, string[]>
  searchReturns?: string[]
  prompt?: (input: RecoveryPrompt, count: number) => unknown | Promise<unknown>
  wait?: (sessionID: string, count: number) => void | Promise<void>
  respondImmediately?: boolean
  now?: () => number
  switchModel?: (input: { sessionID: string; model: { providerID: string; id: string } }) => void | Promise<void>
}

function harness(options: HarnessOptions) {
  const sessions = new Map(Object.entries(options.sessions).map(([id, session]) => [id, { id, ...session } as RecoverSession]))
  const messages = new Map<string, RecoveryMessage[]>([...sessions.keys()].map((id) => [id, []]))
  const children = options.children ?? Object.fromEntries([...sessions.values()].map((session) => [session.id, [...sessions.values()].filter((child) => child.parentID === session.id).map((child) => child.id)]))
  const calls: RecoveryPrompt[] = []
  const sleeps: number[] = []
  let promptCount = 0
  let waitCount = 0
  let admissionCount = 0
  let clock = 1_798_800_000_000
  const storage = makeFakeStorage()
  const deps = {
    storage,
    async get(id: string) { return sessions.get(id) },
    async listSessions(input: { parentID?: string; search?: string; cursor?: string }) {
      const ids = input.parentID
        ? children[input.parentID] ?? []
        : input.search
          ? options.searchReturns ?? [...sessions.keys()]
          : [...sessions.keys()]
      return { data: ids.map((id) => sessions.get(id)!).filter(Boolean).filter((session) => !input.search || (options.searchReturns ? true : (session.title ?? "").toLowerCase().includes(input.search.toLowerCase()))) }
    },
    async prompt(input: RecoveryPrompt) {
      calls.push(input)
      promptCount += 1
      const result = options.prompt ? await options.prompt(input, promptCount) : { id: `admission-${++admissionCount}`, sessionID: input.sessionID }
      const id = result && typeof result === "object" ? (result as { id?: unknown }).id : undefined
      if (typeof id === "string") {
        messages.get(input.sessionID)!.push({ id, role: "user", parts: [{ type: "text", text: input.text }] })
        if (options.respondImmediately) {
          messages.get(input.sessionID)!.push({ id: `instant-${id}`, role: "assistant", parts: [{ type: "text", text: `instant response for ${input.sessionID}` }] })
        }
      }
      if (options.prompt) return result
      return { id, sessionID: input.sessionID }
    },
    async wait(input: { sessionID: string }) {
      waitCount += 1
      if (options.wait) await options.wait(input.sessionID, waitCount)
      const sessionMessages = messages.get(input.sessionID)!
      const admission = [...sessionMessages].reverse().find((message) => ("type" in message ? message.type : message.role) === "user")
      if (admission) sessionMessages.push({ id: `answer-${waitCount}`, role: "assistant", finish: "stop", parts: [{ type: "text", text: `result from ${input.sessionID}` }] })
    },
    async context(input: { sessionID: string }): Promise<readonly RecoveryMessage[]> { return messages.get(input.sessionID) ?? [] },
    async switchModel(input: { sessionID: string; model: { providerID: string; id: string } }) { await options.switchModel?.(input) },
    async sleep(ms: number) { sleeps.push(ms) },
    now() { return options.now?.() ?? clock++ },
  }
  return { deps, calls, sleeps, sessions, messages }
}

const threeLevel = () => ({
  sessions: {
    root: { title: "root", outcome: "failed" as const },
    parent: { title: "parent", parentID: "root", outcome: "failed" as const },
    leaf: { title: "leaf", parentID: "parent", outcome: "failed" as const },
  },
})

test("numeric HTTP status takes precedence over failure-message patterns", () => {
  assert.equal(classifyFailure({ status: 402, message: "payment required" }), "credits")
  assert.equal(classifyFailure({ status: 503, message: "insufficient_quota" }), "unknown")
  assert.equal(classifyFailure(new Error("fetch failed: ECONNRESET")), "network")
})

test("recovers a three-level tree leaf-first, then parent, then root", async () => {
  const h = harness(threeLevel())
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  const resumed = report.actions.filter((action) => action.action === "resumed").map((action) => action.sessionID)
  assert.deepEqual(resumed, ["leaf", "parent", "root"])
  assert.equal(report.rootReactivated, true)
  assert.equal("taskComplete" in report, false)
})

test("non-root session ID climbs to the true root and dry-run plans the full tree", async () => {
  const h = harness(threeLevel())
  const report = await recoverSessions({ rootId: "parent", dryRun: true }, h.deps)

  assert.equal(report.requestedId, "parent")
  assert.equal(report.rootId, "root")
  assert.deepEqual(report.plan?.orderedSessionIDs, ["leaf", "parent", "root"])
  assert.equal(h.calls.length, 0)
})

test("climbing from a middle session does not prompt already-complete ancestors", async () => {
  const h = harness({ sessions: {
    root: { title: "root", outcome: "succeeded" },
    middle: { title: "middle", parentID: "root", outcome: "succeeded" },
    leaf: { title: "leaf", parentID: "middle", outcome: "failed" },
  } })

  const report = await recoverSessions({ rootId: "leaf" }, h.deps)

  assert.equal(report.rootId, "root")
  assert.equal(report.requestedId, "leaf")
  assert.deepEqual(h.calls.map((call) => call.sessionID), ["leaf", "leaf"])
  assert.equal(report.actions.find((action) => action.sessionID === "middle")?.action, "already-complete")
  assert.equal(report.actions.find((action) => action.sessionID === "root")?.action, "already-complete")
})

test("cycle in the parent chain fails closed before prompting", async () => {
  const h = harness({ sessions: {
    root: { title: "root", parentID: "child", outcome: "failed" },
    child: { title: "child", parentID: "root", outcome: "failed" },
  } })

  const report = await recoverSessions({ rootId: "child" }, h.deps)

  assert.equal(report.stoppedBy, "cycle")
  assert.match(report.note ?? "", /parent chain/i)
  assert.equal(h.calls.length, 0)
})

test("sibling barrier stages two ordered handoffs before the parent trigger", async () => {
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      a: { title: "a", parentID: "root", outcome: "failed" },
      b: { title: "b", parentID: "root", outcome: "failed" },
    },
  })
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  const rootCalls = h.calls.filter((call) => call.sessionID === "root")
  assert.deepEqual(rootCalls.map((call) => call.resume), [false, false, false, true])
  assert.deepEqual(rootCalls.slice(0, 3).map((call) => call.delivery), ["queue", "queue", "queue"])
  assert.ok(h.calls.findIndex((call) => call.sessionID === "root") > h.calls.findLastIndex((call) => call.sessionID === "b"))
  assert.deepEqual(report.barriers, [])
})

test("separate handoff prompts contain only their own child's result", async () => {
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      a: { title: "a", parentID: "root", outcome: "failed" },
      b: { title: "b", parentID: "root", outcome: "failed" },
    },
  })
  await recoverSessions({ rootId: "root" }, h.deps)
  const staged = h.calls.filter((call) => call.sessionID === "root" && call.resume === false && call.text.includes("child "))
  assert.equal(staged.length, 2)
  assert.match(staged[0]!.text, /child a/)
  assert.match(staged[0]!.text, /result from a/)
  assert.doesNotMatch(staged[0]!.text, /child b|result from b/)
  assert.match(staged[1]!.text, /child b/)
  assert.match(staged[1]!.text, /result from b/)
  assert.doesNotMatch(staged[1]!.text, /child a|result from a/)
})

test("credit failure aborts immediately without prompting another node", async () => {
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      a: { title: "a", parentID: "root", outcome: "failed" },
      b: { title: "b", parentID: "root", outcome: "failed" },
    },
    prompt: async () => { throw { status: 402, message: "payment required" } },
  })
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  assert.equal(report.stoppedBy, "credits")
  assert.equal(h.calls.length, 1)
  assert.equal(report.actions[0]?.action, "blocked-credits")
})

test("real SDK assistant credit error shape stops the run before any later prompts", async () => {
  const h = harness({ sessions: {
    root: { title: "root", outcome: "failed" },
    leaf: { title: "leaf", parentID: "root", outcome: "failed" },
  } })
  const sdkUser: SessionMessageInfo = {
    id: "admission-1", type: "user", time: { created: 1 }, text: RECOVERY_DIAGNOSTIC,
  }
  const sdkAssistantError: SessionMessageInfo = {
    id: "answer-1", type: "assistant", agent: "general", model: { providerID: "test", id: "model" },
    time: { created: 2, completed: 3 }, content: [], finish: "error",
    error: { type: "provider.usage-limit", message: "credit_balance_exhausted", status: 402 },
  }
  h.deps.prompt = async (input) => {
    h.calls.push(input)
    return { id: "admission-1", sessionID: input.sessionID }
  }
  h.deps.wait = async () => {}
  h.deps.context = async ({ sessionID }) => sessionID === "leaf" ? [sdkUser, sdkAssistantError] as RecoveryMessage[] : []

  const report = await recoverSessions({ rootId: "root" }, h.deps)

  assert.equal(report.stoppedBy, "credits")
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0]?.sessionID, "leaf")
  assert.equal(report.actions[0]?.action, "blocked-credits")
})

test("message normalization reads actual SessionMessageInfo user, assistant content, and structured errors", () => {
  const user: SessionMessageInfo = { id: "u1", type: "user", time: { created: 1 }, text: "queued prompt" }
  const assistantError: SessionMessageInfo = {
    id: "a1", type: "assistant", agent: "general", model: { providerID: "test", id: "model" },
    time: { created: 2 }, finish: "error", content: [
      { type: "text", text: "credit exhausted" },
      {
        type: "tool", id: "tool1", name: "lookup", time: { created: 2, ran: 2, completed: 3 },
        state: { status: "completed", input: {}, content: [{ type: "text", text: "tool output is not assistant prose" }] },
      },
    ],
    error: { type: "provider.usage-limit", message: "credit_balance_exhausted", status: 402 },
  }

  assert.deepEqual(normalizeRecoveryMessage(user), { id: "u1", role: "user", text: "queued prompt" })
  assert.deepEqual(normalizeRecoveryMessage(assistantError), {
    id: "a1", role: "assistant", finish: "error", text: "credit exhausted",
    error: { type: "provider.usage-limit", message: "credit_balance_exhausted", status: 402 },
  })
})

test("hung context is bounded by the run deadline and returns a resumable partial report", async () => {
  const h = harness({ sessions: { root: { title: "root", outcome: "failed" } } })
  h.deps.context = async () => new Promise<readonly RecoveryMessage[]>(() => {})

  const report = await recoverSessions({ rootId: "root", maxDurationMs: 20 }, h.deps)

  assert.equal(report.stoppedBy, "max-duration")
  assert.equal(report.resumable, true)
  assert.match(report.note ?? "", /duration/i)
})

test("recovery notice precedes child handoffs and the resume trigger without resuming the parent", async () => {
  const h = harness({ sessions: {
    root: { title: "root", outcome: "failed" },
    a: { title: "a", parentID: "root", outcome: "failed" },
    b: { title: "b", parentID: "root", outcome: "failed" },
  } })

  await recoverSessions({ rootId: "root" }, h.deps)

  const rootCalls = h.calls.filter((call) => call.sessionID === "root")
  assert.deepEqual(rootCalls.map(({ text, resume, delivery }) => ({ text, resume, delivery })), [
    { text: "Recovery in progress: your children are being finished. Their results will follow.", resume: false, delivery: "queue" },
    { text: rootCalls[1]!.text, resume: false, delivery: "queue" },
    { text: rootCalls[2]!.text, resume: false, delivery: "queue" },
    { text: "The handoffs above are your children's completed final results; do not dispatch any new subagents or repeat their work. Synthesize those results into your own final report and finish your original mission now.", resume: true, delivery: undefined },
  ])
  assert.match(rootCalls[3]!.text, /do not dispatch any new subagents/)
  assert.match(rootCalls[3]!.text, /synthesize/i)
  assert.match(rootCalls[1]!.text, /child a/)
  assert.match(rootCalls[2]!.text, /child b/)
})

test("explicit pinModel switches each resumed session while default recovery leaves models alone", async () => {
  const switched: string[] = []
  const h = harness({
    sessions: { root: { title: "root", outcome: "failed" }, leaf: { title: "leaf", parentID: "root", outcome: "failed" } },
    switchModel: ({ sessionID, model }) => { switched.push(`${sessionID}:${model.providerID}/${model.id}`) },
  })

  await recoverSessions({ rootId: "root", pinModel: "chosen/model" }, h.deps)

  assert.deepEqual(switched, ["leaf:chosen/model", "root:chosen/model"])

  const defaultSwitches: string[] = []
  const defaultHarness = harness({
    sessions: { root: { title: "root", outcome: "failed" } },
    switchModel: ({ sessionID }) => { defaultSwitches.push(sessionID) },
  })
  await recoverSessions({ rootId: "root" }, defaultHarness.deps)
  assert.deepEqual(defaultSwitches, [])
})

test("network failure retries the identical prompt at the specified backoffs", async () => {
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      leaf: { title: "leaf", parentID: "root", outcome: "failed" },
    },
    prompt: async (input, count) => {
      if (count <= 2) throw new Error("getaddrinfo ENOTFOUND api")
      return { id: `admission-${count}`, sessionID: input.sessionID }
    },
  })
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  assert.deepEqual(h.sleeps, [2_000, 10_000])
  assert.equal(h.calls.filter((call) => call.text === RECOVERY_DIAGNOSTIC).length, 3)
  assert.equal(report.actions[0]?.action, "resumed")
  assert.equal(report.actions[0]?.retries, 2)
})

test("wait timeout blocks one node without retry", async () => {
  let waits = 0
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      leaf: { title: "leaf", parentID: "root", outcome: "failed" },
    },
    wait: async () => { waits += 1; if (waits > 1) return new Promise<void>(() => {}) },
  })
  const report = await recoverSessions({ rootId: "root", leafTimeoutMs: 2 }, h.deps)
  assert.equal(h.calls.length, 2)
  assert.equal(report.actions[0]?.action, "blocked-timeout")
  assert.equal(report.actions[0]?.failureClass, "timeout")
})

test("NRR discovery matches observed parenthesized titles and supported bare forms, case-insensitively", async () => {
  const matchingTitles = [
    "(nrr) Social Media Posting Implementation",
    "(nrr) Part II - Deal Pipe - Retro, Images, Available - Blast List",
    "(nrr) Flexible deal intake via email",
    "(nrr) Apify spike: staffing agencies near I-10/Uvalde",
    "NRR foo",
    "NRR: foo",
    "(NRR) foo",
    "nrr - foo",
  ]
  const nonmatchingTitles = ["NRRfoo", "xNRR foo", "Some NRR thing"]
  const sessions = Object.fromEntries([
    ...matchingTitles.map((title, index) => [`match-${index}`, { title, outcome: "failed" as const }]),
    ...nonmatchingTitles.map((title, index) => [`nonmatch-${index}`, { title, outcome: "failed" as const }]),
  ])
  const h = harness({ sessions })
  const report = await recoverSessions({}, h.deps)
  assert.deepEqual(report.candidates?.map((candidate) => candidate.id), matchingTitles.map((_title, index) => `match-${index}`))
  assert.deepEqual(report.candidates?.map((candidate) => candidate.outcome), matchingTitles.map(() => "failed"))
  assert.equal(report.mode, "nrr")
  assert.match(report.note ?? "", /marker "nrr"/)
  assert.equal(report.actions.length, 0)
  assert.equal(h.calls.length, 0)
})

test("custom discovery marker is opt-in and is echoed in discovery notes", async () => {
  const h = harness({
    sessions: {
      candidate: { title: "(failed) a marked session", outcome: "failed" },
      other: { title: "failed: another marked session", outcome: "failed" },
      escaped: { title: "(fail.ed) should not match failed", outcome: "failed" },
    },
  })
  const defaultReport = await recoverSessions({}, h.deps)
  assert.deepEqual(defaultReport.candidates, [])
  assert.match(defaultReport.note ?? "", /marker "nrr"/)
  assert.equal(h.calls.length, 0)

  const customReport = await recoverSessions({ marker: "failed" }, h.deps)
  assert.deepEqual(customReport.candidates?.map((candidate) => candidate.id), ["candidate", "other"])
  assert.match(customReport.note ?? "", /marker "failed"/)
  assert.equal(customReport.mode, "nrr")
  assert.equal(h.calls.length, 0)
})

test("multiple NRR candidates return candidates without prompting; NRRfoo is excluded", async () => {
  const h = harness({
    sessions: {
      one: { title: "NRR first", outcome: "failed" },
      two: { title: "NRR: second", outcome: "succeeded" },
      bad: { title: "NRRfoo", outcome: "failed" },
    },
  })
  const report = await recoverSessions({}, h.deps)
  assert.deepEqual(report.candidates?.map((candidate) => candidate.id), ["one", "two"])
  assert.deepEqual(report.candidates?.map((candidate) => candidate.outcome), ["failed", "succeeded"])
  assert.equal(report.candidates?.[1]?.note, "already complete — not a recovery target unless explicitly selected")
  assert.match(report.note ?? "", /marker "nrr"/)
  assert.equal(report.actions.length, 0)
  assert.equal(h.calls.length, 0)
})

test("NRR discovery uses idle_outcome as a fallback and reports null when no outcome is available", async () => {
  const h = harness({
    sessions: {
      fallback: { title: "NRR idle outcome", idle_outcome: "succeeded" },
      unavailable: { title: "NRR outcome unavailable" },
    },
  })
  const report = await recoverSessions({}, h.deps)
  assert.deepEqual(report.candidates?.map((candidate) => candidate.outcome), ["succeeded", null])
  assert.equal(report.candidates?.[0]?.note, "already complete — not a recovery target unless explicitly selected")
  assert.equal(report.candidates?.[1]?.note, undefined)
  assert.equal(h.calls.length, 0)
})

test("zero NRR candidates return empty discovery without prompts", async () => {
  const h = harness({ sessions: { ordinary: { title: "ordinary", outcome: "failed" } } })
  const report = await recoverSessions({}, h.deps)
  assert.deepEqual(report.candidates, [])
  assert.equal(h.calls.length, 0)
})

test("dry run returns ordered classifications and barriers without prompts", async () => {
  const h = harness(threeLevel())
  const report = await recoverSessions({ rootId: "root", dryRun: true }, h.deps)
  assert.deepEqual(report.plan?.orderedSessionIDs, ["leaf", "parent", "root"])
  assert.equal((report.plan?.nodes as Array<{ plannedAction: string }>)[0]?.plannedAction, "resumed")
  assert.equal(report.dryRun, true)
  assert.equal(h.calls.length, 0)
})

test("successful outcome is already-complete and never prompted", async () => {
  const h = harness({ sessions: { leaf: { title: "leaf", outcome: "succeeded" } } })
  const report = await recoverSessions({ rootId: "leaf" }, h.deps)
  assert.equal(report.actions[0]?.action, "already-complete")
  assert.equal(h.calls.length, 0)
})

test("already-complete parent still blocks ancestors while a descendant remains unresolved", async () => {
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      done: { title: "done", parentID: "root", outcome: "succeeded" },
      blocked: { title: "blocked", parentID: "done" },
    },
  })
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  assert.equal(report.actions.find((action) => action.sessionID === "blocked")?.action, "skipped-unknown")
  assert.equal(report.actions.find((action) => action.sessionID === "done")?.action, "already-complete")
  assert.ok(report.barriers.some((barrier) => barrier.parentID === "done" && barrier.waitingOn.includes("blocked")))
  assert.equal(report.actions.find((action) => action.sessionID === "root")?.action, "blocked-barrier")
  assert.equal(h.calls.length, 0)
})

test("journaled completion makes a second invocation idempotent", async () => {
  const h = harness({ sessions: { leaf: { title: "leaf", outcome: "failed" } } })
  await recoverSessions({ rootId: "leaf" }, h.deps)
  h.calls.length = 0
  const report = await recoverSessions({ rootId: "leaf" }, h.deps)
  assert.equal(report.actions[0]?.action, "already-complete")
  assert.equal(h.calls.length, 0)
})

test("diagnostic prompt is the verbatim F-09 quote plus anti-loop guardrails", async () => {
  const catalog = JSON.parse(await readFile(new URL("../docs/features/features.json", import.meta.url), "utf8")) as Array<{ id: string; provenance: { quote: string } }>
  const quote = catalog.find((record) => record.id === "F-09")?.provenance.quote
  assert.equal(typeof quote, "string", "F-09 provenance quote must exist")

  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      leaf: { title: "leaf", parentID: "root", outcome: "failed" },
    },
  })
  await recoverSessions({ rootId: "root" }, h.deps)
  const sent = h.calls[0]?.text ?? ""

  // The provenance quote stays byte-identical as the prefix; guardrails are appended after it.
  assert.ok(RECOVERY_DIAGNOSTIC.startsWith(quote!), "prompt must start with the verbatim F-09 quote")
  assert.equal(sent, RECOVERY_DIAGNOSTIC)
  assert.ok(sent.startsWith(quote!))
  assert.notEqual(sent, quote, "anti-loop guardrails must be appended, not omitted")
  assert.match(sent, /Answer from your existing context first\./)
  assert.match(sent, /Use at most ONE shell command total/)
  assert.match(sent, /Do not query databases\./)
  assert.equal(sent.match(/Do not dispatch any sub-agent\./g)?.length, 2)
})

test("diagnostic wait cap is 180 seconds", () => {
  assert.equal(DIAGNOSTIC_TIMEOUT_MS, 180_000)
})

test("diagnostic wait is bounded by the cap and blocks the leaf without retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      leaf: { title: "leaf", parentID: "root", outcome: "failed" },
    },
    wait: () => new Promise<void>(() => {}),
  })
  const pending = recoverSessions({ rootId: "root" }, h.deps)
  await new Promise<void>((resolve) => setImmediate(resolve))
  t.mock.timers.tick(DIAGNOSTIC_TIMEOUT_MS)
  const report = await pending
  const leafAction = report.actions.find((action) => action.sessionID === "leaf")
  assert.equal(leafAction?.action, "blocked-timeout")
  assert.equal(leafAction?.failureClass, "timeout")
  assert.equal(leafAction?.retries, 0)
  assert.equal(h.calls.filter((call) => call.text === RECOVERY_DIAGNOSTIC).length, 1)
  assert.equal(report.actions.find((action) => action.sessionID === "root")?.action, "blocked-barrier")
})

test("root reactivation is reported after a response, not as task completion", async () => {
  const h = harness({ sessions: { root: { title: "root", outcome: "failed" } } })
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  assert.equal(report.rootReactivated, true)
  assert.equal("taskComplete" in report, false)
})

test("root is reactivated on its first response without waiting for the full session to go idle", async () => {
  const h = harness({
    sessions: { root: { title: "root", outcome: "failed" } },
    respondImmediately: true,
    wait: async () => new Promise<void>(() => {}),
  })
  const report = await recoverSessions({ rootId: "root", leafTimeoutMs: 2 }, h.deps)
  assert.equal(report.rootReactivated, true)
  assert.equal(report.actions[0]?.action, "resumed")
})

test("cyclic session enumeration aborts before any prompt", async () => {
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      child: { title: "child", parentID: "root", outcome: "failed" },
    },
    children: { root: ["child"], child: ["root"] },
  })
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  assert.equal(report.stoppedBy, "cycle")
  assert.equal(h.calls.length, 0)
})

test("session tree truncation aborts before any prompt", async () => {
  const sessions: Record<string, Omit<RecoverSession, "id">> = {}
  const children: Record<string, string[]> = {}
  for (let index = 0; index < 2_001; index += 1) {
    const id = `node-${index}`
    sessions[id] = { title: id, ...(index ? { parentID: `node-${index - 1}` } : {}), outcome: "failed" }
    children[id] = index < 2_000 ? [`node-${index + 1}`] : []
  }
  const h = harness({ sessions, children })
  const report = await recoverSessions({ rootId: "node-0" }, h.deps)
  assert.equal(report.stoppedBy, "truncated")
  assert.equal(h.calls.length, 0)
})

test("failed staged handoff aborts instead of merging or triggering the parent", async () => {
  const h = harness({
    sessions: {
      root: { title: "root", outcome: "failed" },
      child: { title: "child", parentID: "root", outcome: "failed" },
    },
    prompt: async (input, count) => {
      if (input.resume === false && input.text.includes("child child")) throw new Error("resume:false is unsupported")
      return { id: `admission-${count}`, sessionID: input.sessionID }
    },
  })
  const report = await recoverSessions({ rootId: "root" }, h.deps)
  assert.equal(report.stoppedBy, "handoff-staging")
  assert.equal(report.handoffs[0]?.delivered, false)
  assert.equal(h.calls.some((call) => call.sessionID === "root" && call.resume === true), false)
})
