// Pause and resume for agent sessions.
//
// PAUSE IS PROMPT INJECTION, NOT AN API. There is no way to create a blocking
// form over HTTP: `POST /api/session/:id/form` creates an inert form that
// blocks nothing, and `POST /api/session/:id/interrupt` kills the turn instead
// of holding it (`outcome: "interrupted"` — dead, not waiting). The only thing
// that holds a turn mid-flight is the engine's own ask primitive, which runs
// when the MODEL calls the `question` tool. So `pauseSession` sends the target
// a prompt instructing that tool call, then polls the host's pending forms and
// the session's execution claim (`time_suspended`) until BOTH are observed.
// A prompt the model did not act on is reported `ignored` — never `paused`.
//
// RESUME IS DETERMINISTIC. `POST /api/session/:id/form/:fid/reply` resolves
// the Deferred the form is holding and the SAME turn continues: no new prompt,
// no second billing. Verification is the form leaving the host's pending set,
// i.e. the session leaving the `question-paused` view (running ∧ pending form).
//
// Pending forms live in engine RAM only; they die on an engine restart. A pause
// whose form died reports `stale-form` at resume time and needs a new paid turn
// to come back — which is why every observed pause writes a durable record to
// `<outDir>/pauses/<sessionId>.json`, outside the session database.
//
// Honesty rules baked into this module:
//   - no `paused` unless a NEW form id and the claim were both observed;
//   - an unreachable host before the prompt is `errored`, never a silent no-op;
//   - an unreadable session database is `errored` (the claim cannot be proven);
//   - the pre-prompt snapshot refuses to run over a session that already holds
//     a form, so we never stack a second pause on an existing one.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  createHostClient,
  defaultDbPath,
  projectStatus,
  readSessionRow,
  type FetchLike,
  type HostClient,
  type LiveOptions,
  type StatusProjection,
} from "./status.ts"

// ---------------------------------------------------------------------------
// Durable pause records
// ---------------------------------------------------------------------------

export interface PauseRecord {
  sessionId: string
  formId: string
  /** ISO-8601 time the pause prompt was delivered. */
  askedAt: string
  /** The answer intended for resume; null when the caller supplied none. */
  intendedAnswer: string | null
  /** Root of the session tree the paused session belongs to, when known. */
  treeRoot: string | null
  /** Field keys of the observed form (e.g. ["q0"]), in form order. */
  questionFields: string[]
  /** Set by a successful resume; absent while the pause is outstanding. */
  resumedAt?: string
}

export type PauseStatus = "paused" | "ignored" | "errored" | "timeout"

export interface PauseResult {
  status: PauseStatus
  formId?: string
  fields?: string[]
  waitedMs: number
  detail: string
}

export interface ResumeResult {
  status: "resumed" | "stale-form" | "error"
  detail: string
  waitedMs: number
}

/** Data dir for pause records: env override, else the XDG data dir, else ~/.local/share. */
export function defaultPauseOutDir(): string {
  const explicit = process.env.AGENT_TREES_DATA_DIR
  if (explicit && explicit.trim()) return explicit.trim()
  const xdg = process.env.XDG_DATA_HOME
  return xdg ? join(xdg, "opencode-agent-trees") : join(homedir(), ".local/share/opencode-agent-trees")
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/** `<outDir>/pauses/<sessionId>.json`. Rejects ids that could escape the directory. */
export function pauseRecordPath(outDir: string, sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error(`unsafe session id for a record path: ${JSON.stringify(sessionId)}`)
  return join(outDir, "pauses", `${sessionId}.json`)
}

export async function writePauseRecord(outDir: string, record: PauseRecord): Promise<string> {
  const path = pauseRecordPath(outDir, record.sessionId)
  await mkdir(join(outDir, "pauses"), { recursive: true })
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8")
  return path
}

export async function readPauseRecord(outDir: string, sessionId: string): Promise<PauseRecord | null> {
  try {
    const raw = await readFile(pauseRecordPath(outDir, sessionId), "utf8")
    const parsed = JSON.parse(raw) as PauseRecord
    return parsed && typeof parsed === "object" && typeof parsed.formId === "string" ? parsed : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

/** Every pause record under `<outDir>/pauses`, sorted by sessionId. Malformed files are skipped loudly in the name. */
export async function listPauseRecords(outDir: string): Promise<PauseRecord[]> {
  const directory = join(outDir, "pauses")
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const records: PauseRecord[] = []
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue
    const sessionId = name.slice(0, -".json".length)
    const record = await readPauseRecord(outDir, sessionId)
    if (record) records.push(record)
  }
  return records
}

// ---------------------------------------------------------------------------
// The pause prompt
// ---------------------------------------------------------------------------

/**
 * The exact text `pauseSession` injects. Pause is model-dependent: this asks
 * for the one tool call that can actually hold the turn, and the caller only
 * reports `paused` after the form it produces is observed.
 */
export function buildPausePrompt(question: string): string {
  const trimmed = question.trim()
  return [
    "PAUSE REQUEST — automated control message from the agent-trees orchestrator.",
    "Hold this session here: call the `question` tool NOW, before doing anything else, with exactly ONE question.",
    `Question: ${trimmed}`,
    "Make it a single free-text question (one option plus custom/typed answers allowed) so any reply text is accepted.",
    "Do not answer the question yourself, do not call any other tool, and do not continue the task — wait for the answer.",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Target guard
// ---------------------------------------------------------------------------

export interface PauseTargetRow {
  id: string
  archived: boolean
  isLeaf: boolean
  hasPendingForm: boolean
}

export type GuardResult = { ok: true } | { ok: false; reason: string }

export interface GuardOptions {
  /** Pause non-leaf sessions too. Default false: leaves only. */
  allowNonLeaf?: boolean
  /**
   * Whether the host's pending-form set was actually read. When false the
   * guard refuses: "no pending form" would be an unevidenced claim.
   */
  liveKnown?: boolean
}

/** The four refusals, evaluated before anything is sent. */
export function guardPauseTarget(row: PauseTargetRow, options: GuardOptions = {}): GuardResult {
  if (row.archived) return { ok: false, reason: "archived" }
  if (row.hasPendingForm) return { ok: false, reason: "already has a pending form" }
  if (options.liveKnown === false) {
    return { ok: false, reason: "host live state unavailable — a pending form cannot be ruled out, nothing is sent" }
  }
  if (!options.allowNonLeaf && !row.isLeaf) {
    return { ok: false, reason: "not a leaf (pass --allow-non-leaf to pause non-leaf sessions)" }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Host helpers
// ---------------------------------------------------------------------------

interface PendingForm {
  id: string
  fields?: Array<{ key?: string }>
}

interface HostStatusBody {
  pending?: Record<string, { forms?: unknown[] }>
}

function toPendingForms(body: HostStatusBody, sessionId: string): PendingForm[] {
  const raw = body?.pending?.[sessionId]?.forms
  if (!Array.isArray(raw)) return []
  return raw
    .filter((form): form is Record<string, unknown> => !!form && typeof form === "object")
    .map((form) => ({
      id: typeof form.id === "string" ? form.id : "",
      fields: Array.isArray(form.fields)
        ? form.fields
            .filter((field): field is Record<string, unknown> => !!field && typeof field === "object")
            .map((field) => ({ key: typeof field.key === "string" ? field.key : undefined }))
        : [],
    }))
    .filter((form) => form.id.length > 0)
}

function fieldKeys(forms: readonly PendingForm[]): string[] {
  const keys: string[] = []
  for (const form of forms) {
    for (const field of form.fields ?? []) {
      if (field.key && !keys.includes(field.key)) keys.push(field.key)
    }
  }
  return keys
}

function hostOptions(input: {
  host?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  cookie?: string
  runfilePath?: string
}): LiveOptions {
  return {
    ...(input.host ? { host: input.host } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.cookie ? { cookie: input.cookie } : {}),
    ...(input.runfilePath ? { runfilePath: input.runfilePath } : {}),
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// listPaused
// ---------------------------------------------------------------------------

export interface ListPausedInput {
  /** Defaults to `question-paused` — the verification surface for pause/resume. */
  view?: string
  rootId?: string
  subtreeOf?: string
  limit?: number | null
  all?: boolean
  dbPath?: string
  host?: string | false
  timeoutMs?: number
  fetchImpl?: FetchLike
}

/** Delegates to the existing views projection. */
export function listPaused(input: ListPausedInput = {}): Promise<StatusProjection> {
  return projectStatus({
    ...input,
    view: input.view ?? "question-paused",
  })
}

// ---------------------------------------------------------------------------
// pauseSession
// ---------------------------------------------------------------------------

export interface PauseSessionInput {
  sessionId: string
  question: string
  defaultAnswer?: string | null
  /** Total wait for form + claim to appear. Default 120000. */
  timeoutMs?: number
  /** Poll cadence while waiting. Default 500. */
  pollMs?: number
  /** Root of the target's tree; stored in the record when known. */
  treeRoot?: string | null
  outDir?: string
  host?: string
  dbPath?: string
  /** Host request timeout (auth, snapshot, prompt, polls). Default 15000. */
  requestTimeoutMs?: number
  cookie?: string
  runfilePath?: string
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export const DEFAULT_PAUSE_TIMEOUT_MS = 120_000
const DEFAULT_POLL_MS = 500
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

/**
 * Pause one session: inject the pause prompt, then poll until a NEW pending
 * form AND the execution claim are both observed (or the deadline passes).
 * Writes a durable record only when the pause is verified.
 */
export async function pauseSession(input: PauseSessionInput): Promise<PauseResult> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? defaultSleep
  const pollMs = Math.max(1, input.pollMs ?? DEFAULT_POLL_MS)
  const timeoutMs = Math.max(1, input.timeoutMs ?? DEFAULT_PAUSE_TIMEOUT_MS)
  const dbPath = input.dbPath ?? defaultDbPath()
  const outDir = input.outDir ?? defaultPauseOutDir()
  const text = buildPausePrompt(input.question)
  const t0 = now()

  const failed = (detail: string): PauseResult => ({ status: "errored", waitedMs: now() - t0, detail })

  // 1. The claim source must be readable, or the pause can never be proven.
  try {
    const row = await readSessionRow(dbPath, input.sessionId)
    if (row === null) {
      return failed(`session ${input.sessionId} not found in ${dbPath}; nothing was sent`)
    }
    if (row.timeArchived !== null) {
      return failed(`session ${input.sessionId} is archived; nothing was sent`)
    }
  } catch (error) {
    return failed(
      `session database at ${dbPath} is unreadable (${message(error)}) — the execution claim cannot be verified, nothing was sent`,
    )
  }

  // 2. Authenticated host client; a snapshot before the prompt so a pre-existing
  //    form is a refusal, never mistaken for our own.
  let client: HostClient
  try {
    client = await createHostClient(hostOptions({
      ...(input.host ? { host: input.host } : {}),
      ...(input.requestTimeoutMs ? { timeoutMs: input.requestTimeoutMs } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.runfilePath ? { runfilePath: input.runfilePath } : {}),
    }))
  } catch (error) {
    return failed(`host unavailable (${message(error)}); nothing was sent`)
  }

  const pendingNow = async (): Promise<PendingForm[]> => {
    const body = await client.get<HostStatusBody>("/api/sessions/status")
    return toPendingForms(body ?? {}, input.sessionId)
  }

  let preExisting: PendingForm[]
  try {
    preExisting = await pendingNow()
  } catch (error) {
    return failed(`pending-form snapshot failed (${message(error)}); nothing was sent`)
  }
  if (preExisting.length > 0) {
    return failed(
      `session already holds pending form ${preExisting.map((form) => form.id).join(", ")}; nothing was sent`,
    )
  }

  // 3. Inject the prompt. This is the model-dependent half.
  try {
    await client.post(`/api/session/${encodeURIComponent(input.sessionId)}/prompt`, { text, resume: true })
  } catch (error) {
    return failed(`pause prompt failed (${message(error)})`)
  }

  // 4. Poll for a NEW form together with the execution claim.
  let formSeen: PendingForm | null = null
  let lastPollError: string | null = null
  for (;;) {
    try {
      const forms = await pendingNow()
      lastPollError = null
      const fresh = forms.find((form) => !preExisting.some((old) => old.id === form.id))
      if (fresh) {
        formSeen = fresh
        let claimed: boolean | null = null
        try {
          const row = await readSessionRow(dbPath, input.sessionId)
          claimed = row === null ? false : row.timeSuspended !== null
        } catch {
          claimed = null
        }
        if (claimed === true) {
          const fields = fieldKeys([fresh])
          const waitedMs = now() - t0
          const record: PauseRecord = {
            sessionId: input.sessionId,
            formId: fresh.id,
            askedAt: new Date(now()).toISOString(),
            intendedAnswer: input.defaultAnswer ?? null,
            treeRoot: input.treeRoot ?? null,
            questionFields: fields,
          }
          let detail = `form ${fresh.id} observed with the execution claim held after ${waitedMs}ms`
          try {
            const path = await writePauseRecord(outDir, record)
            detail += `; record written to ${path}`
          } catch (error) {
            detail += `; WARNING: pause is live but the durable record could not be written (${message(error)})`
          }
          return { status: "paused", formId: fresh.id, fields, waitedMs, detail }
        }
      }
    } catch (error) {
      lastPollError = message(error)
    }
    if (now() - t0 >= timeoutMs) break
    await sleep(pollMs)
  }

  const waitedMs = now() - t0
  if (formSeen) {
    return {
      status: "timeout",
      waitedMs,
      detail:
        `form ${formSeen.id} appeared but the execution claim (time_suspended) was never observed within ${waitedMs}ms` +
        (lastPollError ? `; last poll failed: ${lastPollError}` : ""),
    }
  }
  if (lastPollError) {
    return { status: "errored", waitedMs, detail: `could not verify a pause within ${waitedMs}ms: last poll failed: ${lastPollError}` }
  }
  return {
    status: "ignored",
    waitedMs,
    detail: `prompt delivered but no pending form appeared within ${waitedMs}ms — the model did not call the question tool`,
  }
}

// ---------------------------------------------------------------------------
// resumeSession
// ---------------------------------------------------------------------------

export interface ResumeSessionInput {
  sessionId: string
  formId: string
  answer: string
  /** Grace period for the form to disappear after the reply. Default 15000. */
  timeoutMs?: number
  pollMs?: number
  outDir?: string
  host?: string
  requestTimeoutMs?: number
  cookie?: string
  runfilePath?: string
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export const DEFAULT_RESUME_GRACE_MS = 15_000

/**
 * Reply to a paused form and verify the session leaves `question-paused`
 * (its pending form set no longer contains this form). The reply resolves the
 * engine's Deferred, so the SAME turn continues — no new prompt is sent.
 */
export async function resumeSession(input: ResumeSessionInput): Promise<ResumeResult> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? defaultSleep
  const pollMs = Math.max(1, input.pollMs ?? DEFAULT_POLL_MS)
  const graceMs = Math.max(1, input.timeoutMs ?? DEFAULT_RESUME_GRACE_MS)
  const outDir = input.outDir ?? defaultPauseOutDir()
  const t0 = now()

  let client: HostClient
  try {
    client = await createHostClient(hostOptions({
      ...(input.host ? { host: input.host } : {}),
      ...(input.requestTimeoutMs ? { timeoutMs: input.requestTimeoutMs } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.runfilePath ? { runfilePath: input.runfilePath } : {}),
    }))
  } catch (error) {
    return { status: "error", waitedMs: now() - t0, detail: `host unavailable (${message(error)})` }
  }

  const pendingNow = async (): Promise<PendingForm[]> => {
    const body = await client.get<HostStatusBody>("/api/sessions/status")
    return toPendingForms(body ?? {}, input.sessionId)
  }

  let forms: PendingForm[]
  try {
    forms = await pendingNow()
  } catch (error) {
    return { status: "error", waitedMs: now() - t0, detail: `pending-form snapshot failed (${message(error)})` }
  }

  const target = forms.find((form) => form.id === input.formId)
  if (!target) {
    return {
      status: "stale-form",
      waitedMs: now() - t0,
      detail:
        `form ${input.formId} is no longer pending for ${input.sessionId} — pending forms live in engine RAM and die on restart/turn end. ` +
        "A reply cannot revive it: resuming this session needs a NEW paid turn (send a fresh prompt, e.g. tree.wake), not a form reply.",
    }
  }

  // Answer every field of the observed form: our pause asks exactly one
  // question, so the intended answer is the value for each key.
  const keys = fieldKeys([target])
  const answerKeys = keys.length ? keys : ["q0"]
  const answer: Record<string, string> = {}
  for (const key of answerKeys) answer[key] = input.answer

  try {
    await client.post(
      `/api/session/${encodeURIComponent(input.sessionId)}/form/${encodeURIComponent(input.formId)}/reply`,
      { answer },
    )
  } catch (error) {
    const text = message(error)
    if (text.includes("HTTP 404")) {
      return {
        status: "stale-form",
        waitedMs: now() - t0,
        detail:
          `reply to ${input.formId} returned 404 — the form died (engine restart or turn end). ` +
          "Resuming this session needs a NEW paid turn (send a fresh prompt), not a form reply.",
      }
    }
    return { status: "error", waitedMs: now() - t0, detail: `form reply failed (${text})` }
  }

  // Verify the session leaves question-paused: the form must leave the pending set.
  let lastPollError: string | null = null
  for (;;) {
    try {
      const nowForms = await pendingNow()
      lastPollError = null
      if (!nowForms.some((form) => form.id === input.formId)) {
        const others = nowForms.length
        const waitedMs = now() - t0
        let detail = `reply accepted and form ${input.formId} left the pending set after ${waitedMs}ms — the session left question-paused and the turn continues in-place`
        if (others > 0) detail += ` (${others} other pending form(s) remain)`
        // Best-effort audit mark: the resume succeeded either way.
        try {
          const record = await readPauseRecord(outDir, input.sessionId)
          if (record && record.formId === input.formId && !record.resumedAt) {
            await writePauseRecord(outDir, { ...record, resumedAt: new Date(now()).toISOString() })
            detail += "; record marked resumed"
          }
        } catch {
          detail += "; WARNING: could not mark the pause record resumed"
        }
        return { status: "resumed", waitedMs, detail }
      }
    } catch (error) {
      lastPollError = message(error)
    }
    if (now() - t0 >= graceMs) break
    await sleep(pollMs)
  }
  return {
    status: "error",
    waitedMs: now() - t0,
    detail:
      `reply was accepted but form ${input.formId} is still pending after ${now() - t0}ms — the session has not left question-paused` +
      (lastPollError ? `; last poll failed: ${lastPollError}` : ""),
  }
}

// ---------------------------------------------------------------------------

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
