import test from "node:test"
import assert from "node:assert/strict"

import { appendEntry, readJournal, JOURNAL_PREFIX } from "../src/lib/journal.ts"
import { buildFamily, describeSelf } from "../src/lib/family.ts"
import { formatHandoff } from "../src/lib/handoff.ts"
import { makeFakeCtx, seedFamily } from "./fake-ctx.ts"

// ---------------------------------------------------------------- journal ---

test("appendEntry numbers entries 1..n in call order", async () => {
  const ctx = makeFakeCtx()
  const a = await appendEntry(ctx.storage, "ses_a", { kind: "note", text: "one" })
  const b = await appendEntry(ctx.storage, "ses_a", { kind: "note", text: "two" })

  assert.equal(a.seq, 1)
  assert.equal(b.seq, 2)
  assert.deepEqual(
    (await readJournal(ctx.storage, "ses_a")).map((e) => e.text),
    ["one", "two"],
  )
})

test("appendEntry survives 20 concurrent appends without losing a write", async () => {
  const ctx = makeFakeCtx()
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => appendEntry(ctx.storage, "ses_c", { kind: "note", text: `n${i}` })),
  )
  const entries = await readJournal(ctx.storage, "ses_c")
  assert.equal(entries.length, 20)
  assert.deepEqual(
    entries.map((e) => e.seq).sort((x, y) => x - y),
    Array.from({ length: 20 }, (_, i) => i + 1),
  )
})

test("journals are keyed per session under journal:<sessionID>", async () => {
  const ctx = makeFakeCtx()
  await appendEntry(ctx.storage, "ses_x", { kind: "note", text: "for x" })
  await appendEntry(ctx.storage, "ses_y", { kind: "note", text: "for y" })

  assert.deepEqual(
    (await readJournal(ctx.storage, "ses_x")).map((e) => e.text),
    ["for x"],
  )
  assert.deepEqual(
    await ctx.storage.get(`${JOURNAL_PREFIX}ses_x`),
    await ctx.storage.get("journal:ses_x"),
  )
  assert.deepEqual(
    ctx.storage.keys().filter((k) => k.startsWith("journal:")),
    ["journal:ses_x", "journal:ses_y"],
  )
})

test("appendEntry records status/error records verbatim", async () => {
  const ctx = makeFakeCtx()
  await appendEntry(ctx.storage, "ses_p", {
    kind: "child_result",
    childID: "ses_child",
    status: "error",
    error: "Go usage limit exceeded",
  })
  const [entry] = await readJournal(ctx.storage, "ses_p")
  assert.equal(entry.kind, "child_result")
  assert.equal(entry.childID, "ses_child")
  assert.equal(entry.status, "error")
  assert.equal(entry.error, "Go usage limit exceeded")
})

// ----------------------------------------------------------------- family ---

test("describeSelf reports own id, agent, parent, root and depth", async () => {
  const ctx = makeFakeCtx()
  seedFamily(ctx, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_child: { parentID: "ses_root", agent: "general", title: "child" },
    ses_grandchild: { parentID: "ses_child", agent: "explore", title: "grandchild" },
  })

  const self = describeSelf("ses_grandchild", (id) => ctx.get(id))
  assert.equal(self.sessionID, "ses_grandchild")
  assert.equal(self.agent, "explore")
  assert.equal(self.title, "grandchild")
  assert.equal(self.parentID, "ses_child")
  assert.equal(self.rootID, "ses_root")
  assert.equal(self.depth, 2)
})

test("describeSelf treats a root session as its own root at depth 0", async () => {
  const ctx = makeFakeCtx()
  seedFamily(ctx, { ses_root: { agent: "orchestrator", title: "root" } })
  const self = describeSelf("ses_root", (id) => ctx.get(id))
  assert.equal(self.parentID, undefined)
  assert.equal(self.rootID, "ses_root")
  assert.equal(self.depth, 0)
})

test("buildFamily renders root -> child -> grandchild with outcomes, siblings included", async () => {
  const ctx = makeFakeCtx()
  seedFamily(ctx, {
    ses_root: { agent: "orchestrator", title: "root", outcome: "succeeded" },
    ses_a: { parentID: "ses_root", agent: "general", title: "a", outcome: "succeeded" },
    ses_b: { parentID: "ses_root", agent: "general", title: "b", outcome: "failed" },
    ses_b1: {
      parentID: "ses_b",
      agent: "explore",
      title: "b1",
      model: { providerID: "opencode-go", id: "mimo-v2.6-flash" },
    },
  })

  const tree = await buildFamily({ sessionID: "ses_b1" }, ctx.deps)
  assert.equal(tree.rootID, "ses_root")
  assert.equal(tree.focusID, "ses_b1")

  const root = tree.tree
  assert.equal(root.sessionID, "ses_root")
  assert.equal(root.children.length, 2)
  assert.deepEqual(
    root.children.map((c) => c.sessionID),
    ["ses_a", "ses_b"],
  )
  const b = root.children[1]
  assert.equal(b.outcome, "failed")
  assert.equal(b.children.length, 1)
  assert.equal(b.children[0].sessionID, "ses_b1")
  assert.equal(b.children[0].model, "opencode-go/mimo-v2.6-flash")
  assert.equal(tree.nodeCount, 4)
})

test("buildFamily with includeSelf:false returns the focus node's children only", async () => {
  const ctx = makeFakeCtx()
  seedFamily(ctx, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_a: { parentID: "ses_root", agent: "general", title: "a" },
    ses_a1: { parentID: "ses_a", agent: "general", title: "a1" },
  })

  const tree = await buildFamily({ sessionID: "ses_a", includeSelf: false }, ctx.deps)
  assert.deepEqual(
    tree.tree.children.map((c) => c.sessionID),
    ["ses_a1"],
  )
})

test("buildFamily respects maxNodes and flags truncation", async () => {
  const ctx = makeFakeCtx()
  seedFamily(ctx, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_a: { parentID: "ses_root", agent: "general", title: "a" },
    ses_b: { parentID: "ses_root", agent: "general", title: "b" },
    ses_a1: { parentID: "ses_a", agent: "general", title: "a1" },
  })

  const tree = await buildFamily({ sessionID: "ses_root", maxNodes: 2 }, ctx.deps)
  assert.equal(tree.nodeCount, 2)
  assert.equal(tree.truncated, true)
})

test("buildFamily stops at a cycle instead of hanging", async () => {
  const ctx = makeFakeCtx()
  seedFamily(ctx, {
    ses_root: { parentID: "ses_a", agent: "orchestrator", title: "root" },
    ses_a: { parentID: "ses_root", agent: "general", title: "a" },
  })
  const tree = await buildFamily({ sessionID: "ses_a" }, ctx.deps)
  assert.ok(tree.nodeCount >= 1)
  assert.equal(tree.cycleDetected, true)
})

test("buildFamily does not recursively duplicate nodes on a downward cycle", async () => {
  const ctx = makeFakeCtx()
  seedFamily(ctx, {
    ses_root: { agent: "orchestrator", title: "root" },
    ses_a: { parentID: "ses_root", agent: "general", title: "a" },
  })
  // Simulate corrupt data where the root appears as its own descendant.
  ctx.deps.listChildren = async (parentID) => {
    if (parentID === "ses_root") return [ctx.get("ses_a")!]
    if (parentID === "ses_a") return [ctx.get("ses_root")!]
    return []
  }

  const tree = await buildFamily({ sessionID: "ses_root" }, ctx.deps)
  assert.equal(tree.nodeCount, 2)
  assert.equal(tree.cycleDetected, true)
})

// ---------------------------------------------------------------- handoff ---

test("formatHandoff matches the required message format", () => {
  assert.equal(
    formatHandoff({
      reporterID: "ses_root",
      childID: "ses_child",
      parentID: "ses_root",
      outcome: "finished",
      summary: "wrote 3 files",
    }),
    "Agent-tree handoff from ses_root: child ses_child (parent ses_root) finished. Here is what it reported: wrote 3 files.",
  )
})

test("formatHandoff maps failed outcomes to died and appends the note", () => {
  assert.equal(
    formatHandoff({
      reporterID: "ses_root",
      childID: "ses_dead",
      parentID: "ses_root",
      outcome: "died",
      summary: "Go usage limit exceeded",
      note: "pin the model next time",
    }),
    "Agent-tree handoff from ses_root: child ses_dead (parent ses_root) died. Here is what it reported: Go usage limit exceeded. Note: pin the model next time.",
  )
})
