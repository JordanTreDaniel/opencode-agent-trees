import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildPausePrompt,
  defaultPauseOutDir,
  guardPauseTarget,
  listPauseRecords,
  pauseRecordPath,
  pauseSession,
  readPauseRecord,
  resumeSession,
  writePauseRecord,
  type PauseRecord,
} from "../src/lib/pause.ts"
import type { FetchLike, FetchResponseLike } from "../src/lib/status.ts"
import { writeSessionDb } from "./status-fixture.ts"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string
  url: string
  body: unknown
}

interface StubRoute {
  /** Pending forms for one session as the host would report them. */
  pending?: () => Record<string, { forms: unknown[] }>
  /** Status code for the prompt POST. */
  promptStatus?: number
  /** Status code for the form reply POST. */
  replyStatus?: number
}

function jsonResponse(body: unknown, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error("no content")
      return body
    },
    headers: { get: () => null },
  }
}

function makeHost(route: StubRoute): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const method = typeof init.method === "string" ? init.method : "GET"
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ method, url: String(url), body })
    if (method === "GET" && String(url).includes("/api/sessions/status")) {
      return jsonResponse({ pending: route.pending?.() ?? {} })
    }
    if (method === "POST" && String(url).includes("/prompt")) {
      return jsonResponse({ ok: true }, route.promptStatus ?? 200)
    }
    if (method === "POST" && String(url).includes("/reply")) {
      return jsonResponse(undefined, route.replyStatus ?? 204)
    }
    return jsonResponse({ error: "unexpected route" }, 404)
  }
  return { fetchImpl, calls }
}

function stubHostOptions(fetchImpl: FetchLike) {
  return { host: "http://localhost:3000", cookie: "stub-cookie", fetchImpl }
}

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

// ---------------------------------------------------------------------------
// Target guard
// ---------------------------------------------------------------------------

const leafRow = { id: "ses_leaf", archived: false, isLeaf: true, hasPendingForm: false }

test("pause targets are leaves by default", () => {
  assert.deepEqual(guardPauseTarget(leafRow), { ok: true })
  const nonLeaf = { ...leafRow, isLeaf: false }
  const refused = guardPauseTarget(nonLeaf)
  assert.equal(refused.ok, false)
  assert.match(refused.ok === false ? refused.reason : "", /not a leaf/)
})

test("a non-leaf is refused without the flag and allowed with --allow-non-leaf", () => {
  const nonLeaf = { ...leafRow, isLeaf: false }
  const refused = guardPauseTarget(nonLeaf, { allowNonLeaf: false })
  assert.equal(refused.ok, false)
  const allowed = guardPauseTarget(nonLeaf, { allowNonLeaf: true })
  assert.deepEqual(allowed, { ok: true })
})

test("a session that already holds a pending form is refused", () => {
  const refused = guardPauseTarget({ ...leafRow, hasPendingForm: true })
  assert.equal(refused.ok, false)
  assert.match(refused.ok === false ? refused.reason : "", /already has a pending form/)
})

test("archived sessions and an unreadable live source are refused before anything is sent", () => {
  const archived = guardPauseTarget({ ...leafRow, archived: true })
  assert.equal(archived.ok, false)
  assert.match(archived.ok === false ? archived.reason : "", /archived/)

  const liveUnknown = guardPauseTarget(leafRow, { liveKnown: false })
  assert.equal(liveUnknown.ok, false)
  assert.match(liveUnknown.ok === false ? liveUnknown.reason : "", /pending form cannot be ruled out/)
})

// ---------------------------------------------------------------------------
// pauseSession
// ---------------------------------------------------------------------------

test("pause reports ignored — honestly — when the prompt is delivered but no form appears", async () => {
  const fixture = writeSessionDb([{ id: "ses_target", suspended: 1000 }])
  const outDir = tmpDir("tree-pause-ignored-")
  const { fetchImpl, calls } = makeHost({ pending: () => ({}) })
  let clock = 0
  try {
    const result = await pauseSession({
      sessionId: "ses_target",
      question: "Hold here?",
      timeoutMs: 50,
      dbPath: fixture.path,
      outDir,
      ...stubHostOptions(fetchImpl),
      now: () => clock,
      sleep: async () => {
        clock += 10
      },
    })
    assert.equal(result.status, "ignored")
    assert.match(result.detail, /did not call the question tool/)
    assert.equal(result.formId, undefined, "no form was observed, so no form id may be reported")
    assert.ok(
      calls.some((call) => call.method === "POST" && call.url.includes("/prompt")),
      "the pause prompt was actually sent",
    )
    assert.deepEqual(await listPauseRecords(outDir), [], "no record without a verified pause")
  } finally {
    fixture.cleanup()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("pause requires the execution claim: a form without a claim times out, never reports paused", async () => {
  const fixture = writeSessionDb([{ id: "ses_unclaimed" }]) // time_suspended is null
  const outDir = tmpDir("tree-pause-noClaim-")
  let polls = 0
  const { fetchImpl } = makeHost({
    // Empty pre-prompt snapshot, then a form — but the claim never appears.
    pending: (): Record<string, { forms: unknown[] }> => {
      polls += 1
      return polls === 1 ? {} : { ses_unclaimed: { forms: [{ id: "frm_orphan", fields: [{ key: "q0" }] }] } }
    },
  })
  let clock = 0
  try {
    const result = await pauseSession({
      sessionId: "ses_unclaimed",
      question: "Hold here?",
      timeoutMs: 30,
      dbPath: fixture.path,
      outDir,
      ...stubHostOptions(fetchImpl),
      now: () => clock,
      sleep: async () => {
        clock += 10
      },
    })
    assert.equal(result.status, "timeout")
    assert.match(result.detail, /execution claim/)
    assert.equal(result.formId, undefined)
  } finally {
    fixture.cleanup()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("pause verifies form + claim, then writes the durable record (round-trip)", async () => {
  const fixture = writeSessionDb([{ id: "ses_paused", suspended: 4242 }])
  const outDir = tmpDir("tree-pause-ok-")
  let polls = 0
  let clock = 1_700_000_000_000
  const { fetchImpl, calls } = makeHost({
    // First call is the pre-prompt snapshot (no form); the form appears after
    // the prompt, exactly like a real question-tool turn.
    pending: (): Record<string, { forms: unknown[] }> => {
      polls += 1
      return polls === 1
        ? {}
        : { ses_paused: { forms: [{ id: "frm_observed", fields: [{ key: "q0" }, { key: "q1" }] }] } }
    },
  })
  try {
    const result = await pauseSession({
      sessionId: "ses_paused",
      question: "Continue?",
      defaultAnswer: "proceed",
      timeoutMs: 5000,
      treeRoot: "ses_root",
      dbPath: fixture.path,
      outDir,
      ...stubHostOptions(fetchImpl),
      now: () => clock,
      sleep: async () => {
        clock += 10
      },
    })
    assert.equal(result.status, "paused")
    assert.equal(result.formId, "frm_observed")
    assert.deepEqual(result.fields, ["q0", "q1"])
    assert.ok(
      calls.some((call) => call.method === "POST" && call.url.includes("/prompt")),
      "the pause prompt was injected before verification",
    )

    const record = await readPauseRecord(outDir, "ses_paused")
    assert.ok(record, "a verified pause writes a record")
    assert.equal(record.formId, "frm_observed")
    assert.equal(record.intendedAnswer, "proceed")
    assert.equal(record.treeRoot, "ses_root")
    assert.deepEqual(record.questionFields, ["q0", "q1"])
    assert.equal(typeof record.askedAt, "string")
    assert.equal(record.resumedAt, undefined)

    const raw = JSON.parse(readFileSync(pauseRecordPath(outDir, "ses_paused"), "utf8")) as PauseRecord
    assert.equal(raw.sessionId, "ses_paused")
  } finally {
    fixture.cleanup()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("pause refuses a session that already holds a pending form, before prompting", async () => {
  const fixture = writeSessionDb([{ id: "ses_busy", suspended: 9 }])
  const outDir = tmpDir("tree-pause-pre-")
  const { fetchImpl, calls } = makeHost({
    pending: () => ({ ses_busy: { forms: [{ id: "frm_existing", fields: [{ key: "q0" }] }] } }),
  })
  try {
    const result = await pauseSession({
      sessionId: "ses_busy",
      question: "Hold here?",
      dbPath: fixture.path,
      outDir,
      ...stubHostOptions(fetchImpl),
    })
    assert.equal(result.status, "errored")
    assert.match(result.detail, /already holds pending form frm_existing/)
    assert.equal(
      calls.some((call) => call.method === "POST" && call.url.includes("/prompt")),
      false,
      "no second prompt is stacked onto an existing form",
    )
  } finally {
    fixture.cleanup()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("pause refuses when the claim source cannot be read — unverifiable is never paused", async () => {
  const outDir = tmpDir("tree-pause-nodb-")
  const { fetchImpl, calls } = makeHost({ pending: () => ({}) })
  try {
    const result = await pauseSession({
      sessionId: "ses_anywhere",
      question: "Hold here?",
      dbPath: join(outDir, "does-not-exist.db"),
      outDir,
      ...stubHostOptions(fetchImpl),
    })
    assert.equal(result.status, "errored")
    assert.match(result.detail, /cannot be verified/)
    assert.equal(calls.some((call) => call.method === "POST"), false, "nothing is sent without a claim source")
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// resumeSession
// ---------------------------------------------------------------------------

const seedRecord: PauseRecord = {
  sessionId: "ses_paused",
  formId: "frm_observed",
  askedAt: "2026-11-11T12:00:00.000Z",
  intendedAnswer: "proceed",
  treeRoot: "ses_root",
  questionFields: ["q0"],
}

test("resume reports stale-form when the form died — a reply is never claimed as success", async () => {
  const outDir = tmpDir("tree-resume-stale-")
  await writePauseRecord(outDir, seedRecord)
  const { fetchImpl, calls } = makeHost({ pending: () => ({}) }) // engine restarted: no forms left
  try {
    const result = await resumeSession({
      sessionId: seedRecord.sessionId,
      formId: seedRecord.formId,
      answer: "proceed",
      outDir,
      ...stubHostOptions(fetchImpl),
    })
    assert.equal(result.status, "stale-form")
    assert.match(result.detail, /NEW paid turn/)
    assert.equal(
      calls.some((call) => call.method === "POST" && call.url.includes("/reply")),
      false,
      "no reply is posted to a form that is not pending",
    )
    const record = await readPauseRecord(outDir, seedRecord.sessionId)
    assert.equal(record?.resumedAt, undefined, "a stale-form is not marked resumed")
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("resume maps a 404 reply onto stale-form instead of a generic error", async () => {
  const outDir = tmpDir("tree-resume-404-")
  const { fetchImpl } = makeHost({
    pending: () => ({ ses_paused: { forms: [{ id: "frm_observed", fields: [{ key: "q0" }] }] } }),
    replyStatus: 404,
  })
  try {
    const result = await resumeSession({
      sessionId: "ses_paused",
      formId: "frm_observed",
      answer: "proceed",
      outDir,
      ...stubHostOptions(fetchImpl),
    })
    assert.equal(result.status, "stale-form")
    assert.match(result.detail, /404/)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("resume posts the answer, verifies the form left the pending set, and marks the record", async () => {
  const outDir = tmpDir("tree-resume-ok-")
  await writePauseRecord(outDir, seedRecord)
  let replied = false
  const { fetchImpl, calls } = makeHost({
    pending: (): Record<string, { forms: unknown[] }> => (replied ? {} : { ses_paused: { forms: [{ id: "frm_observed", fields: [{ key: "q0" }] }] } }),
  })
  // Flip the pending set only after the reply POST lands.
  const original = fetchImpl
  const flipping: FetchLike = async (url, init) => {
    const response = await original(url, init)
    if (typeof init?.method === "string" && init.method === "POST" && String(url).includes("/reply")) replied = true
    return response
  }
  let clock = 1_700_000_000_500
  try {
    const result = await resumeSession({
      sessionId: "ses_paused",
      formId: "frm_observed",
      answer: "proceed",
      outDir,
      ...stubHostOptions(flipping),
      now: () => clock,
      sleep: async () => {
        clock += 10
      },
    })
    assert.equal(result.status, "resumed")
    assert.match(result.detail, /left question-paused/)

    const reply = calls.find((call) => call.method === "POST" && call.url.includes("/reply"))
    assert.ok(reply, "the reply was posted")
    assert.match(reply.url, /\/api\/session\/ses_paused\/form\/frm_observed\/reply$/)
    assert.deepEqual(reply.body, { answer: { q0: "proceed" } }, "the answer is keyed by the observed form field")

    const record = await readPauseRecord(outDir, "ses_paused")
    assert.ok(record?.resumedAt, "a verified resume marks the record")
    const raw = JSON.parse(readFileSync(pauseRecordPath(outDir, "ses_paused"), "utf8")) as PauseRecord
    assert.equal(raw.formId, "frm_observed", "the record keeps its original identity")
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

test("pause records round-trip through <outDir>/pauses/<sessionId>.json", async () => {
  const outDir = tmpDir("tree-record-")
  try {
    assert.deepEqual(await listPauseRecords(outDir), [], "an empty directory reads as no records")
    await writePauseRecord(outDir, seedRecord)
    await writePauseRecord(outDir, { ...seedRecord, sessionId: "ses_other", formId: "frm_2" })

    const read = await readPauseRecord(outDir, "ses_paused")
    assert.deepEqual(read, seedRecord)

    const all = await listPauseRecords(outDir)
    assert.deepEqual(all.map((record) => record.sessionId), ["ses_other", "ses_paused"])
    assert.equal(await readPauseRecord(outDir, "ses_missing"), null)

    const onDisk = JSON.parse(readFileSync(pauseRecordPath(outDir, "ses_paused"), "utf8")) as PauseRecord
    assert.deepEqual(onDisk, seedRecord)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("record paths cannot escape the record directory", () => {
  assert.throws(() => pauseRecordPath("/tmp/records", "../evil"), /unsafe session id/)
  assert.throws(() => pauseRecordPath("/tmp/records", "a/b"), /unsafe session id/)
  assert.equal(pauseRecordPath("/tmp/records", "ses_ok"), "/tmp/records/pauses/ses_ok.json")
})

test("the pause prompt asks for the question tool and quotes the question verbatim", () => {
  const prompt = buildPausePrompt("Deploy the staging build?")
  assert.match(prompt, /question` tool/)
  assert.match(prompt, /Deploy the staging build\?/)
  assert.match(prompt, /wait for the answer/)
  assert.equal(defaultPauseOutDir().includes("pauses"), false, "records live under a data dir, not the repo")
})
