import { appendEntry, readJournal, type StorageLike } from "./journal.ts"
import { loadAncestors, type SessionLike } from "./family.ts"
import { formatHandoff, outcomeWord } from "./handoff.ts"
import type { SessionMessageInfo } from "@opencode/client"

export const RECOVERY_DIAGNOSTIC =
  "You are being resumed. Report only: your own session id from env | grep -i OPENCODE, your session_v2.time_created and message count, your direct parent id from the db, the root id, and one line from memory about what your original mission told you to do. Do not dispatch any sub-agent. Max 6 lines." +
  " Answer from your existing context first. Use at most ONE shell command total if a fact is truly unavailable, then answer. Do not query databases. Do not dispatch any sub-agent."

const LEAF_CONTINUE = "Continue and finish up your original work now. When done, end with a single-line summary of what you completed."
const RECOVERY_NOTICE = "Recovery in progress: your children are being finished. Their results will follow."
const PARENT_CONTINUE =
  "The handoffs above are your children's completed final results; do not dispatch any new subagents or repeat their work. " +
  "Synthesize those results into your own final report and finish your original mission now."
const BACKOFF_MS = [2_000, 10_000, 30_000] as const
const MAX_NODES = 2_000
export const DIAGNOSTIC_TIMEOUT_MS = 180_000
const ROOT_RESPONSE_TIMEOUT_MS = 120_000

export interface RecoverSession extends SessionLike {
  time?: { created?: number; updated?: number; busy?: number | boolean; idle?: number | boolean }
  status?: string
  idle_outcome?: string
}

interface LegacyRecoveryMessage {
  id?: string
  type?: string
  role?: string
  finish?: string
  error?: unknown
  time?: { created?: number }
  parts?: readonly unknown[]
  text?: string
  content?: unknown
  [key: string]: unknown
}

export type RecoveryMessage = SessionMessageInfo | LegacyRecoveryMessage

export interface RecoveryPrompt {
  sessionID: string
  text: string
  resume?: boolean
  delivery?: "steer" | "queue"
}

export interface RecoveryListInput {
  parentID?: string
  search?: string
  cursor?: string
}

export interface RecoverDeps {
  storage: StorageLike
  get(id: string): Promise<RecoverSession | undefined>
  listSessions(input: RecoveryListInput): Promise<{ data: readonly RecoverSession[]; cursor?: { next?: string } }>
  prompt(input: RecoveryPrompt): Promise<unknown>
  wait(input: { sessionID: string }): Promise<void>
  context(input: { sessionID: string }): Promise<readonly RecoveryMessage[]>
  switchModel?(input: { sessionID: string; model: { providerID: string; id: string } }): Promise<void>
  sleep(ms: number): Promise<void>
  now(): number
}

export interface RecoverInput {
  rootId?: string
  marker?: string
  dryRun?: boolean
  leafTimeoutMs?: number
  maxDurationMs?: number
  pinModel?: string
  progress?: (update: unknown) => void | Promise<void>
  signal?: AbortSignal
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function discoveryMatcher(marker: string): RegExp {
  return new RegExp(`^\\(?\\s*${escapeRegExp(marker)}\\)?(?:[.:—–\\- ]|$)`, "i")
}

export type FailureClass = "credits" | "auth" | "network" | "timeout" | "unknown"
export type NodeState = "succeeded" | "failed" | "interrupted" | "running" | "unknown" | "already-complete" | "recovered" | "blocked"
export type RecoveryRole = "leaf" | "parent" | "root"

export interface RecoveryAction {
  runId: string
  sessionID: string
  role: RecoveryRole
  action: "resumed" | "already-complete" | "pending" | "blocked-credits" | "blocked-auth" | "blocked-network" | "blocked-timeout" | "blocked-unknown-error" | "blocked-barrier" | "skipped-unknown"
  failureClass?: FailureClass
  retries?: number
  diagnostic?: string
  summary?: string
  model?: string
  error?: string
}

export interface RecoveryHandoff {
  runId: string
  childID: string
  parentID: string
  delivered: boolean
  parentResumed: boolean
}

export interface RecoveryBarrier {
  runId: string
  parentID: string
  waitingOn: string[]
}

export interface RecoveryReport {
  runId: string
  mode: "root" | "nrr"
  candidates?: Array<{ id: string; title?: string; time?: RecoverSession["time"]; outcome: string | null; note?: string }>
  requestedId?: string
  rootId?: string
  dryRun?: boolean
  plan?: Record<string, unknown>
  actions: RecoveryAction[]
  handoffs: RecoveryHandoff[]
  barriers: RecoveryBarrier[]
  rootReactivated: boolean
  stoppedBy?: string
  resumable?: boolean
  note?: string
  stats: { resumed: number; alreadyComplete: number; blocked: number; pending: number }
  durationMs: number
}

interface NodeRecord {
  session: RecoverSession
  children: NodeRecord[]
  classification: Exclude<NodeState, "already-complete" | "recovered" | "blocked">
  alreadyComplete: boolean
  context: readonly RecoveryMessage[]
  summary?: string
}

interface AttemptResult {
  admitted: unknown
  messages: readonly RecoveryMessage[]
  summary: string
  diagnostic?: string
}

function errorParts(error: unknown): { message: string; status?: number; body?: string } {
  if (error && typeof error === "object") {
    const item = error as { type?: unknown; message?: unknown; status?: unknown; response?: { body?: unknown } }
    const body = typeof item.response?.body === "string" ? item.response.body : ""
    return {
      message: `${typeof item.type === "string" ? item.type : ""} ${typeof item.message === "string" ? item.message : String(error)} ${body}`,
      ...(typeof item.status === "number" ? { status: item.status } : {}),
      ...(body ? { body } : {}),
    }
  }
  return { message: String(error) }
}

export function classifyFailure(error: unknown): FailureClass {
  const { message, status } = errorParts(error)
  if (status !== undefined) {
    if (status === 401 || status === 403) return "auth"
    if (status === 402) return "credits"
    if (status === 429 && /credit|usage limit|quota|rate limit/i.test(message)) return "credits"
    return "unknown"
  }
  if (/credit_balance_exhausted|usage limit|insufficient_quota|free usage limit reached|go usage limit exceeded/i.test(message)) return "credits"
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|fetch failed|network|socket hang up/i.test(message)) return "network"
  if (/TimeoutError|operation timed out|timed out/i.test(message)) return "timeout"
  return "unknown"
}

function messageRole(message: RecoveryMessage): string | undefined {
  const raw = message as LegacyRecoveryMessage
  if (typeof raw.type === "string") return raw.type
  if (typeof raw.role === "string") return raw.role
  const info = raw.info
  if (info && typeof info === "object") {
    const data = info as { type?: unknown; role?: unknown }
    if (typeof data.type === "string") return data.type
    if (typeof data.role === "string") return data.role
  }
  return undefined
}

function messageID(message: RecoveryMessage): string | undefined {
  const raw = message as LegacyRecoveryMessage
  if (typeof raw.id === "string") return raw.id
  const info = raw.info
  if (info && typeof info === "object" && typeof (info as { id?: unknown }).id === "string") return (info as { id: string }).id
  return undefined
}

function finishOf(message: RecoveryMessage): string | undefined {
  const raw = message as LegacyRecoveryMessage
  if (typeof raw.finish === "string") return raw.finish
  const info = raw.info
  if (info && typeof info === "object" && typeof (info as { finish?: unknown }).finish === "string") return (info as { finish: string }).finish
  return undefined
}

function errorOf(message: RecoveryMessage): unknown {
  const raw = message as LegacyRecoveryMessage
  if (raw.error !== undefined) return raw.error
  const info = raw.info
  return info && typeof info === "object" ? (info as { error?: unknown }).error : undefined
}

function textOf(message: RecoveryMessage): string {
  const raw = message as LegacyRecoveryMessage
  if (typeof raw.text === "string") return raw.text
  const parts = raw.parts
  if (Array.isArray(parts)) {
    return parts.map((part) => {
      if (!part || typeof part !== "object") return ""
      const item = part as { type?: unknown; text?: unknown }
      return item.type === "text" && typeof item.text === "string" ? item.text : ""
    }).filter(Boolean).join("\n")
  }
  const content = raw.content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part || typeof part !== "object") return ""
      const item = part as { type?: unknown; text?: unknown }
      return item.type === "text" && typeof item.text === "string" ? item.text : ""
    }).filter(Boolean).join("\n")
  }
  return typeof content === "string" ? content : ""
}

export function normalizeRecoveryMessage(message: SessionMessageInfo | RecoveryMessage) {
  const role = messageRole(message)
  const id = messageID(message)
  const finish = finishOf(message)
  const error = errorOf(message)
  return {
    ...(id ? { id } : {}),
    ...(role ? { role } : {}),
    ...(finish ? { finish } : {}),
    text: textOf(message),
    ...(error !== undefined ? { error } : {}),
  }
}

function assistantMessages(messages: readonly RecoveryMessage[]): RecoveryMessage[] {
  return messages.filter((message) => messageRole(message) === "assistant")
}

function successfulAssistant(message: RecoveryMessage): boolean {
  const finish = finishOf(message)
  return !errorOf(message) && (finish === "stop" || finish === "length")
}

function isActive(session: RecoverSession, messages: readonly RecoveryMessage[]): boolean {
  if (/^(busy|running|active)$/i.test(session.status ?? "")) return true
  const busy = session.time?.busy
  const idle = session.time?.idle
  if (busy === true) return true
  if (typeof busy === "number" && (typeof idle !== "number" || busy > idle)) return true
  const last = assistantMessages(messages).at(-1)
  return !!last && (!finishOf(last) || finishOf(last) === "tool-calls") && !errorOf(last)
}

function successfulAfterLastError(messages: readonly RecoveryMessage[]): boolean {
  const assistants = assistantMessages(messages)
  let lastError = -1
  for (let i = 0; i < assistants.length; i += 1) {
    const message = assistants[i]!
    if (errorOf(message) || finishOf(message) === "error") lastError = i
  }
  return assistants.slice(lastError + 1).some(successfulAssistant)
}

function latestAssistantText(messages: readonly RecoveryMessage[]): string {
  const assistants = assistantMessages(messages)
  for (let i = assistants.length - 1; i >= 0; i -= 1) {
    const text = textOf(assistants[i]!).trim()
    if (text) return text.slice(0, 1_000)
  }
  return "Recovered work; no assistant summary was available."
}

function messagesAfterAdmission(messages: readonly RecoveryMessage[], admission: unknown): RecoveryMessage[] {
  const id = admission && typeof admission === "object" ? (admission as { id?: unknown }).id : undefined
  if (typeof id !== "string") return []
  const index = messages.findIndex((message) => messageID(message) === id)
  return index < 0 ? [] : messages.slice(index + 1)
}

function responseError(messages: readonly RecoveryMessage[]): unknown {
  const assistants = assistantMessages(messages)
  const last = assistants.at(-1)
  if (!last) return undefined
  if (errorOf(last)) return errorOf(last)
  if (finishOf(last) === "error") return { message: "assistant response ended with error" }
  return undefined
}

function waitWithTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  heartbeat?: () => void,
  timeoutError = new Error("operation timed out"),
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const heartbeatTimer = heartbeat ? setInterval(heartbeat, 15_000) : undefined
    const cleanup = () => {
      clearTimeout(timer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    }
    timer = setTimeout(() => { cleanup(); reject(timeoutError) }, timeoutMs)
    promise.then(
      () => { cleanup(); resolve() },
      (error) => { cleanup(); reject(error) },
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRootResponse(
  deps: RecoverDeps,
  sessionID: string,
  admission: unknown,
  timeoutMs: number,
  heartbeat: () => void,
  timeoutError: Error,
  withinDeadline: <T>(operation: () => PromiseLike<T> | T) => Promise<T>,
): Promise<readonly RecoveryMessage[]> {
  const waitState: { value: "pending" | "resolved" | "rejected" } = { value: "pending" }
  let waitError: unknown
  let waitTimer: ReturnType<typeof setTimeout> | undefined
  const waitPromise = new Promise<void>((resolve, reject) => {
    waitTimer = setTimeout(() => {
      waitState.value = "rejected"
      waitError = timeoutError
      reject(timeoutError)
    }, timeoutMs)
    Promise.resolve().then(() => deps.wait({ sessionID })).then(
      () => { if (waitTimer) clearTimeout(waitTimer); waitState.value = "resolved"; resolve() },
      (error) => { if (waitTimer) clearTimeout(waitTimer); waitState.value = "rejected"; waitError = error; reject(error) },
    )
  })
  void waitPromise.catch(() => {})
  const stopWaitTimer = () => { if (waitTimer) clearTimeout(waitTimer) }
  const deadline = Date.now() + timeoutMs
  try {
    while (true) {
      const allMessages = await withinDeadline(() => deps.context({ sessionID }))
      const messages = messagesAfterAdmission(allMessages, admission)
      if (assistantMessages(messages).length) return messages
      if (waitState.value === "rejected") throw waitError
      if (waitState.value === "resolved") throw new Error("root became idle without a response after the recovery trigger")
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw timeoutError
      await Promise.race([withinDeadline(() => delay(Math.min(500, remaining))), waitPromise])
      if (remaining < timeoutMs && Math.floor(remaining / 15_000) !== Math.floor((remaining - Math.min(500, remaining)) / 15_000)) heartbeat()
    }
  } finally {
    stopWaitTimer()
  }
}

class RecoveryDurationExceeded extends Error {
  constructor() { super("maximum recovery duration reached") }
}

function roleFor(node: NodeRecord, rootId: string): RecoveryRole {
  if (node.session.id === rootId) return "root"
  return node.children.length ? "parent" : "leaf"
}

function makeStats(actions: readonly RecoveryAction[]) {
  return {
    resumed: actions.filter((action) => action.action === "resumed").length,
    alreadyComplete: actions.filter((action) => action.action === "already-complete").length,
    blocked: actions.filter((action) => action.action.startsWith("blocked-") || action.action === "skipped-unknown").length,
    pending: actions.filter((action) => action.action === "pending").length,
  }
}

export async function recoverSessions(input: RecoverInput, deps: RecoverDeps): Promise<RecoveryReport> {
  const started = deps.now()
  const maxDurationMs = Math.max(1, input.maxDurationMs ?? 3_600_000)
  const deadlineAt = Date.now() + maxDurationMs
  const runId = new Date(started).toISOString()
  const mode = input.rootId ? "root" : "nrr"
  let rootId = input.rootId
  let requestedId = input.rootId
  const actions: RecoveryAction[] = []
  const handoffs: RecoveryHandoff[] = []
  const barriers: RecoveryBarrier[] = []
  let stoppedBy: string | undefined
  const remainingMs = () => Math.max(0, deadlineAt - Date.now())
  const withDeadline = <T>(operation: () => PromiseLike<T> | T): Promise<T> => {
    const remaining = remainingMs()
    if (remaining <= 0) return Promise.reject(new RecoveryDurationExceeded())
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new RecoveryDurationExceeded()), remaining)
      Promise.resolve().then(operation).then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
      )
    })
  }
  const report = (extra: Partial<RecoveryReport> = {}): RecoveryReport => ({
    runId,
    mode,
    ...(requestedId && rootId && requestedId !== rootId ? { requestedId } : {}),
    ...(rootId ? { rootId } : {}),
    actions,
    handoffs,
    barriers,
    rootReactivated: false,
    stats: makeStats(actions),
    durationMs: Math.max(0, deps.now() - started),
    ...extra,
  })
  const progress = async (message: string) => {
    try {
      await withDeadline(() => input.progress?.({ title: "Recovering session tree", message, runId }))
    } catch (error) {
      if (error instanceof RecoveryDurationExceeded) stoppedBy = "max-duration"
      // Progress reporting must not change whether a session can be recovered.
    }
  }
  const leafTimeoutMs = Math.max(1, input.leafTimeoutMs ?? 900_000)
  const timedOut = () => remainingMs() <= 0

  const listAll = async (options: Omit<RecoveryListInput, "cursor">): Promise<RecoverSession[]> => {
    const result: RecoverSession[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    while (true) {
      if (timedOut()) throw new RecoveryDurationExceeded()
      const page = await withDeadline(() => deps.listSessions({ ...options, ...(cursor ? { cursor } : {}) }))
      result.push(...page.data)
      const next = page.cursor?.next
      if (!next) return result
      if (seen.has(next)) throw new Error(`session list repeated cursor: ${next}`)
      seen.add(next)
      cursor = next
    }
  }

  if (!rootId) {
    const marker = input.marker?.trim() || "nrr"
    const matchesMarker = discoveryMatcher(marker)
    let searched: RecoverSession[]
    try {
      searched = await listAll({ search: marker })
    } catch (error) {
      if (error instanceof RecoveryDurationExceeded) return report({ stoppedBy: "max-duration", resumable: true, note: `Maximum duration reached while discovering marker "${marker}"; rerun to continue.` })
      return report({ stoppedBy: "discovery-error", note: `Marker "${marker}" search failed: ${errorParts(error).message}` })
    }
    let candidates = searched.filter((session) => matchesMarker.test(session.title ?? ""))
    if (!candidates.length) {
      try {
        const full = await listAll({})
        candidates = full.filter((session) => matchesMarker.test(session.title ?? ""))
      } catch (error) {
        if (error instanceof RecoveryDurationExceeded) return report({ stoppedBy: "max-duration", resumable: true, note: `Maximum duration reached while discovering marker "${marker}"; rerun to continue.` })
        return report({ stoppedBy: "discovery-error", note: `Fallback session scan for marker "${marker}" failed: ${errorParts(error).message}` })
      }
    }
    candidates = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
    const shaped = candidates.map(({ id, title, time, outcome, idle_outcome }) => {
      const candidateOutcome = outcome ?? idle_outcome ?? null
      return {
        id,
        ...(title ? { title } : {}),
        ...(time ? { time } : {}),
        outcome: candidateOutcome,
        ...(candidateOutcome === "succeeded" ? { note: "already complete — not a recovery target unless explicitly selected" } : {}),
      }
    })
    if (candidates.length === 0) return report({ candidates: [], note: `No sessions found for marker "${marker}"; no prompts were sent.` })
    if (candidates.length > 1) {
      return report({ candidates: shaped, note: `Multiple sessions found for marker "${marker}"; choose one rootId. Succeeded sessions are already complete. No prompts were sent.` })
    }
    rootId = candidates[0]!.id
    requestedId = rootId
  }

  let root: RecoverSession | undefined
  try {
    root = await withDeadline(() => deps.get(rootId!))
  } catch (error) {
    if (error instanceof RecoveryDurationExceeded) return report({ rootId, stoppedBy: "max-duration", resumable: true, note: "Maximum duration reached while loading the root; rerun to continue." })
    return report({ rootId, stoppedBy: "root-read-error", note: `Could not load the root session: ${errorParts(error).message}` })
  }
  if (!root) return report({ rootId, stoppedBy: "root-not-found", note: `Session not found: ${rootId}` })

  // rootId is an entry point, not necessarily the tree root. Resolve its full
  // ancestor chain before enumerating descendants so recovery always plans the
  // complete tree and can preserve already-complete ancestors.
  let ancestorCache: Map<string, SessionLike>
  try {
    ancestorCache = await withDeadline(() => loadAncestors(root!.id, { get: deps.get }))
  } catch (error) {
    if (error instanceof RecoveryDurationExceeded) return report({ rootId, stoppedBy: "max-duration", resumable: true, note: "Maximum duration reached while climbing to the root; no prompts were sent." })
    return report({ rootId, stoppedBy: "root-read-error", note: `Could not load the parent chain: ${errorParts(error).message}` })
  }
  const ancestorIDs = new Set<string>([root.id])
  let ancestor = root
  let ancestorCount = 0
  while (ancestor.parentID) {
    if (ancestorIDs.has(ancestor.parentID)) {
      return report({
        stoppedBy: "cycle",
        note: `Cycle detected in the parent chain above ${requestedId}; no prompts were sent.`,
      })
    }
    if (ancestorCount >= MAX_NODES) {
      return report({
        stoppedBy: "truncated",
        note: `Parent chain exceeds the ${MAX_NODES}-session cap; no prompts were sent.`,
      })
    }
    ancestorIDs.add(ancestor.parentID)
    let parent = ancestorCache.get(ancestor.parentID) as RecoverSession | undefined
    if (!parent) {
      try {
        parent = await withDeadline(() => deps.get(ancestor.parentID!))
      } catch (error) {
        if (error instanceof RecoveryDurationExceeded) return report({ stoppedBy: "max-duration", resumable: true, note: "Maximum duration reached while climbing to the root; no prompts were sent." })
        return report({ stoppedBy: "root-read-error", note: `Could not load parent ${ancestor.parentID}: ${errorParts(error).message}` })
      }
    }
    if (!parent) {
      return report({
        stoppedBy: "parent-not-found",
        note: `Parent session not found: ${ancestor.parentID}; no prompts were sent.`,
      })
    }
    ancestor = parent
    ancestorCount += 1
  }
  root = ancestor
  rootId = root.id

  let nodeCount = 0
  let cycleDetected = false
  let truncated = false
  const visited = new Set<string>()
  const build = async (session: RecoverSession, path: Set<string>): Promise<NodeRecord> => {
    if (timedOut()) throw new RecoveryDurationExceeded()
    if (path.has(session.id) || visited.has(session.id)) {
      cycleDetected = true
      return { session, children: [], classification: "unknown", alreadyComplete: false, context: [] }
    }
    if (nodeCount >= MAX_NODES) {
      truncated = true
      return { session, children: [], classification: "unknown", alreadyComplete: false, context: [] }
    }
    nodeCount += 1
    visited.add(session.id)
    const nextPath = new Set(path).add(session.id)
    const kids: RecoverSession[] = []
    let cursor: string | undefined
    const cursors = new Set<string>()
    while (true) {
      const page = await withDeadline(() => deps.listSessions({ parentID: session.id, ...(cursor ? { cursor } : {}) }))
      kids.push(...page.data)
      const next = page.cursor?.next
      if (!next) break
      if (cursors.has(next)) throw new Error(`session list repeated cursor for parent ${session.id}`)
      cursors.add(next)
      cursor = next
    }
    if (kids.length + nodeCount > MAX_NODES) truncated = true
    const children: NodeRecord[] = []
    for (const kid of kids) {
      if (nodeCount >= MAX_NODES) {
        truncated = true
        break
      }
      children.push(await build(kid, nextPath))
    }
    let context: readonly RecoveryMessage[] = []
    try {
      context = await withDeadline(() => deps.context({ sessionID: session.id }))
    } catch (error) {
      if (error instanceof RecoveryDurationExceeded) throw error
      // Context is evidence, not a reason to guess: classification below fails closed.
    }
    const journal = await withDeadline(() => readJournal(deps.storage, session.id))
    const lastErrorIndex = context.reduce((index, message, i) => errorOf(message) || finishOf(message) === "error" ? i : index, -1)
    const succeededAfterError = context.slice(lastErrorIndex + 1).some((message) => messageRole(message) === "assistant" && successfulAssistant(message))
    const alreadyComplete = session.outcome === "succeeded" || journal.some((entry) => entry.kind === "recovery:done") || succeededAfterError
    let classification: NodeRecord["classification"]
    if (alreadyComplete) classification = session.outcome === "succeeded" ? "succeeded" : "unknown"
    else if (session.outcome === "failed" || session.outcome === "interrupted") classification = session.outcome
    else if (session.outcome === undefined && isActive(session, context)) classification = "running"
    else classification = "unknown"
    return { session, children, classification, alreadyComplete, context, ...(alreadyComplete ? { summary: latestAssistantText(context) } : {}) }
  }

  let tree: NodeRecord
  try {
    tree = await build(root, new Set())
  } catch (error) {
    if (error instanceof RecoveryDurationExceeded) return report({ rootId, stoppedBy: "max-duration", resumable: true, note: "Maximum duration reached while walking the tree; no prompts were sent." })
    return report({ rootId, stoppedBy: "walk-error", note: `Could not enumerate the session tree: ${errorParts(error).message}` })
  }
  if (cycleDetected || truncated) {
    return report({
      rootId,
      stoppedBy: cycleDetected ? "cycle" : "truncated",
      note: cycleDetected ? "Cycle detected in the session tree; no prompts were sent." : `Tree exceeds the ${MAX_NODES}-node cap; no prompts were sent.`,
      plan: { nodeCount, cycleDetected, truncated },
    })
  }

  const postorder: NodeRecord[] = []
  const flatten = (node: NodeRecord) => {
    node.children.forEach(flatten)
    postorder.push(node)
  }
  flatten(tree)
  const planNodes = postorder.map((node) => ({
    sessionID: node.session.id,
    role: roleFor(node, rootId!),
    classification: node.alreadyComplete ? "already-complete" : node.classification,
    plannedAction: node.alreadyComplete ? "already-complete" : node.classification === "running" ? "pending" : node.classification === "unknown" ? "skipped-unknown" : "resumed",
    model: node.session.model ? `${node.session.model.providerID}/${node.session.model.id}` : undefined,
  }))
  const planBarriers = postorder.filter((node) => node.children.length).map((node) => ({
    parentID: node.session.id,
    waitingOn: node.children.filter((child) => !child.alreadyComplete && child.classification !== "succeeded").map((child) => child.session.id),
  }))
  if (input.dryRun) {
    return report({ rootId, dryRun: true, plan: { nodeCount, nodes: planNodes, orderedSessionIDs: postorder.map((node) => node.session.id), barriers: planBarriers } })
  }

  let modelPin: { providerID: string; id: string } | undefined
  if (input.pinModel !== undefined) {
    const slash = input.pinModel.indexOf("/")
    if (slash <= 0 || slash === input.pinModel.length - 1) {
      return report({ rootId, stoppedBy: "invalid-model-pin", note: "pinModel must use providerID/modelID format." })
    }
    if (!deps.switchModel) {
      return report({ rootId, stoppedBy: "model-pin-unsupported", resumable: true, note: "This runtime does not expose session.switchModel; no prompts were sent." })
    }
    modelPin = { providerID: input.pinModel.slice(0, slash), id: input.pinModel.slice(slash + 1) }
  }

  const state = new Map<string, "succeeded" | "already-complete" | "recovered" | "pending" | "blocked">()
  const summaries = new Map<string, string>()
  let rootReactivated = false
  const pinnedSessions = new Set<string>()

  const addAction = (node: NodeRecord, action: RecoveryAction["action"], extra: Partial<RecoveryAction> = {}) => {
    const item: RecoveryAction = {
      runId,
      sessionID: node.session.id,
      role: roleFor(node, rootId!),
      action,
      ...(node.session.model ? { model: `${node.session.model.providerID}/${node.session.model.id}` } : {}),
      ...extra,
    }
    actions.push(item)
    return item
  }

  const overDuration = (node: NodeRecord): boolean => {
    if (input.signal?.aborted) {
      stoppedBy = "cancelled"
      addAction(node, "pending", { error: "Recovery cancelled." })
      state.set(node.session.id, "pending")
      return true
    }
    if (timedOut()) {
      stoppedBy = "max-duration"
      addAction(node, "pending", { error: "Maximum recovery duration reached." })
      state.set(node.session.id, "pending")
      return true
    }
    return false
  }

  const doPrompt = async (
    node: NodeRecord,
    prompt: RecoveryPrompt,
    waitMs: number,
    diagnostic?: boolean,
    requireFinal = true,
  ): Promise<{ result?: AttemptResult; failure?: FailureClass; error?: unknown; retries: number }> => {
    let tries = 0
    while (tries < 3) {
      if (overDuration(node)) return { failure: "timeout", error: new Error("maximum duration"), retries: tries }
      tries += 1
      let durationLimited = false
      try {
        await progress(`${node.session.id}: ${diagnostic ? "diagnostic" : "resume"} attempt ${tries}`)
        if (stoppedBy === "max-duration") throw new RecoveryDurationExceeded()
        const remaining = remainingMs()
        if (!remaining) throw new RecoveryDurationExceeded()
        const admitted = await withDeadline(() => deps.prompt(prompt))
        const remainingAfterAdmission = remainingMs()
        durationLimited = remainingAfterAdmission <= waitMs
        const timeoutError = durationLimited ? new RecoveryDurationExceeded() : new Error("operation timed out")
        let messages: readonly RecoveryMessage[]
        if (!requireFinal) {
          messages = await waitForRootResponse(
            deps,
            node.session.id,
            admitted,
            Math.min(waitMs, remainingAfterAdmission),
            () => { void progress(`${node.session.id}: waiting for root response`) },
            timeoutError,
            withDeadline,
          )
        } else {
          await waitWithTimeout(
            deps.wait({ sessionID: node.session.id }),
            Math.min(waitMs, remainingAfterAdmission),
            () => { void progress(`${node.session.id}: waiting for response`) },
            timeoutError,
          )
          const allMessages = await withDeadline(() => deps.context({ sessionID: node.session.id }))
          messages = messagesAfterAdmission(allMessages, admitted)
        }
        await progress(`${node.session.id}: response received`)
        if (stoppedBy === "max-duration") throw new RecoveryDurationExceeded()
        const responseFailure = responseError(messages)
        if (responseFailure) throw responseFailure
        const assistants = assistantMessages(messages)
        if (!assistants.length) throw new Error("session became idle without an assistant response after the recovery prompt")
        const lastAssistant = assistants.at(-1)!
        if (requireFinal && !successfulAssistant(lastAssistant)) {
          throw new Error("session became idle without a terminal successful assistant response")
        }
        const text = textOf(lastAssistant).trim().slice(0, 1_000)
        return { result: { admitted, messages, summary: text || "Recovery response completed without text." }, retries: tries - 1 }
      } catch (error) {
        if (error instanceof RecoveryDurationExceeded || durationLimited && classifyFailure(error) === "timeout") {
          stoppedBy = "max-duration"
          addAction(node, "pending", { error: "Maximum recovery duration reached while awaiting a response." })
          state.set(node.session.id, "pending")
          return { failure: "timeout", error, retries: tries - 1 }
        }
        const failure = classifyFailure(error)
        if (failure === "credits" || failure === "auth") return { failure, error, retries: tries - 1 }
        if (failure === "network" && tries < 3) {
          try {
            await withDeadline(() => deps.sleep(BACKOFF_MS[tries - 1]!))
          } catch (sleepError) {
            if (sleepError instanceof RecoveryDurationExceeded) {
              stoppedBy = "max-duration"
              addAction(node, "pending", { error: "Maximum recovery duration reached during retry backoff." })
              state.set(node.session.id, "pending")
              return { failure: "timeout", error: sleepError, retries: tries - 1 }
            }
            return { failure: classifyFailure(sleepError), error: sleepError, retries: tries - 1 }
          }
          continue
        }
        return { failure, error, retries: tries - 1 }
      }
    }
    return { failure: "unknown", error: new Error("attempt loop exhausted"), retries: 2 }
  }

  const recordFailure = (node: NodeRecord, failure: FailureClass, error: unknown, retries: number, diagnostic?: string) => {
    const action = failure === "credits" ? "blocked-credits" : failure === "auth" ? "blocked-auth" : failure === "network" ? "blocked-network" : failure === "timeout" ? "blocked-timeout" : "blocked-unknown-error"
    addAction(node, action, { failureClass: failure, retries, error: errorParts(error).message, ...(diagnostic ? { diagnostic } : {}) })
    state.set(node.session.id, "blocked")
    if (failure === "credits" || failure === "auth") stoppedBy = failure
  }

  const pinNodeModel = async (node: NodeRecord): Promise<boolean> => {
    if (!modelPin || pinnedSessions.has(node.session.id)) return true
    try {
      await withDeadline(() => deps.switchModel!({ sessionID: node.session.id, model: modelPin! }))
      pinnedSessions.add(node.session.id)
      return true
    } catch (error) {
      if (error instanceof RecoveryDurationExceeded) {
        stoppedBy = "max-duration"
        addAction(node, "pending", { error: "Maximum recovery duration reached while pinning the session model." })
        state.set(node.session.id, "pending")
      } else {
        recordFailure(node, classifyFailure(error), error, 0)
      }
      return false
    }
  }

  const completeNode = async (node: NodeRecord, summary: string, diagnostic?: string, retries = 0) => {
    node.summary = summary.slice(0, 1_000)
    summaries.set(node.session.id, node.summary)
    try {
      await withDeadline(() => appendEntry(deps.storage, node.session.id, { kind: "recovery:done", runId, summary: node.summary! }))
    } catch (error) {
      if (!(error instanceof RecoveryDurationExceeded)) throw error
      stoppedBy = "max-duration"
      addAction(node, "pending", { error: "Maximum recovery duration reached while writing the completion journal." })
      state.set(node.session.id, "pending")
      return
    }
    addAction(node, "resumed", { summary: node.summary, ...(diagnostic ? { diagnostic } : {}), ...(retries ? { retries } : {}) })
    state.set(node.session.id, "recovered")
  }

  const stageQueuedMessage = async (sessionID: string, text: string) => {
    let error: unknown
    let failure: FailureClass = "unknown"
    let retries = 0
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await withDeadline(() => deps.prompt({ sessionID, text, resume: false, delivery: "queue" }))
        return { staged: true, retries }
      } catch (caught) {
        error = caught
        if (caught instanceof RecoveryDurationExceeded) return { staged: false, error, failure: "timeout" as const, retries }
        failure = classifyFailure(caught)
        if (failure !== "network" || attempt === 3) return { staged: false, error, failure, retries }
        retries += 1
        try {
          await withDeadline(() => deps.sleep(BACKOFF_MS[attempt - 1]!))
        } catch (sleepError) {
          return {
            staged: false,
            error: sleepError,
            failure: sleepError instanceof RecoveryDurationExceeded ? "timeout" : classifyFailure(sleepError),
            retries,
          }
        }
      }
    }
    return { staged: false, error: error ?? new Error("staging attempts exhausted"), failure, retries }
  }

  for (const node of postorder) {
    if (stoppedBy) break
    if (overDuration(node)) break
    const id = node.session.id
    if (node.alreadyComplete || node.classification === "succeeded") {
      node.summary ??= latestAssistantText(node.context)
      summaries.set(id, node.summary)
      addAction(node, "already-complete", { summary: node.summary })
      const unresolved = node.children.filter((child) => {
        const childState = state.get(child.session.id)
        return childState !== "succeeded" && childState !== "already-complete" && childState !== "recovered"
      }).map((child) => child.session.id)
      if (unresolved.length) {
        barriers.push({ runId, parentID: id, waitingOn: unresolved })
        state.set(id, "blocked")
      } else {
        state.set(id, "already-complete")
      }
      continue
    }
    if (node.classification === "running") {
      addAction(node, "pending")
      state.set(id, "pending")
      continue
    }
    if (node.classification === "unknown") {
      addAction(node, "skipped-unknown", { error: "No terminal outcome or reliable active marker; fail-closed." })
      state.set(id, "blocked")
      continue
    }

    const unresolved = node.children.filter((child) => {
      const childState = state.get(child.session.id)
      return childState !== "succeeded" && childState !== "already-complete" && childState !== "recovered"
    }).map((child) => child.session.id)
    if (unresolved.length) {
      barriers.push({ runId, parentID: id, waitingOn: unresolved })
      addAction(node, "blocked-barrier", { error: `Required child recoveries unresolved: ${unresolved.join(", ")}` })
      state.set(id, "blocked")
      continue
    }

    const role = roleFor(node, rootId!)
    let diagnostic: string | undefined
    if (!node.children.length && role !== "root") {
      if (!(await pinNodeModel(node))) break
      const first = await doPrompt(node, { sessionID: id, text: RECOVERY_DIAGNOSTIC, resume: true }, DIAGNOSTIC_TIMEOUT_MS, true)
      if (!first.result) {
        if (stoppedBy) break
        recordFailure(node, first.failure ?? "unknown", first.error, first.retries)
        continue
      }
      diagnostic = first.result.summary
      await progress(`${id}: diagnostic captured`)
      if (stoppedBy) break
      const second = await doPrompt(node, { sessionID: id, text: LEAF_CONTINUE, resume: true }, leafTimeoutMs)
      if (!second.result) {
        if (stoppedBy) break
        recordFailure(node, second.failure ?? "unknown", second.error, second.retries, diagnostic)
        continue
      }
      await progress(`${id}: leaf recovery finished`)
      if (stoppedBy) break
      await completeNode(node, second.result.summary, diagnostic, first.retries + second.retries)
      if (stoppedBy) break
      continue
    }

    const directChildren = node.children.filter((child) => state.get(child.session.id) === "recovered")
    if (!(await pinNodeModel(node))) break
    if (directChildren.length) {
      const notice = await stageQueuedMessage(id, RECOVERY_NOTICE)
      if (!notice.staged) {
        if (notice.failure === "timeout") {
          stoppedBy = "max-duration"
          addAction(node, "pending", { error: "Maximum recovery duration reached while staging the parent recovery notice." })
          state.set(id, "pending")
        } else {
          const failure = notice.failure ?? "unknown"
          const action = failure === "credits" ? "blocked-credits" : failure === "auth" ? "blocked-auth" : failure === "network" ? "blocked-network" : "blocked-unknown-error"
          addAction(node, action, { failureClass: failure, retries: notice.retries, error: `Parent recovery notice staging failed: ${errorParts(notice.error).message}` })
          state.set(id, "blocked")
          stoppedBy = failure === "credits" || failure === "auth" ? failure : "notice-staging"
        }
        break
      }
    }
    for (const child of directChildren) {
      const summary = summaries.get(child.session.id) ?? child.summary ?? latestAssistantText(child.context)
      const text = formatHandoff({
        reporterID: id,
        childID: child.session.id,
        parentID: id,
        outcome: outcomeWord("succeeded"),
        summary,
      })
      const handoffResult = await stageQueuedMessage(id, text)
      if (!handoffResult.staged && handoffResult.failure === "timeout") {
        handoffs.push({ runId, childID: child.session.id, parentID: id, delivered: false, parentResumed: false })
        addAction(node, "pending", { error: "Maximum recovery duration reached while staging a child handoff." })
        state.set(id, "pending")
        stoppedBy = "max-duration"
        break
      }
      if (handoffResult.staged) {
        handoffs.push({ runId, childID: child.session.id, parentID: id, delivered: true, parentResumed: false })
      } else {
        handoffs.push({ runId, childID: child.session.id, parentID: id, delivered: false, parentResumed: false })
        const stageFailure = handoffResult.failure ?? "unknown"
        addAction(node, stageFailure === "credits" ? "blocked-credits" : stageFailure === "auth" ? "blocked-auth" : stageFailure === "network" ? "blocked-network" : stageFailure === "timeout" ? "blocked-timeout" : "blocked-unknown-error", {
          failureClass: stageFailure,
          retries: handoffResult.retries,
          error: `Handoff staging failed; recovery aborted without merging messages: ${errorParts(handoffResult.error).message}`,
        })
        state.set(id, "blocked")
        stoppedBy = stageFailure === "credits" || stageFailure === "auth" ? stageFailure : "handoff-staging"
        break
      }
    }
    if (stoppedBy) break

    const trigger = await doPrompt(node, { sessionID: id, text: PARENT_CONTINUE, resume: true }, role === "root" ? ROOT_RESPONSE_TIMEOUT_MS : leafTimeoutMs, undefined, role !== "root")
    if (!trigger.result) {
      if (stoppedBy) break
      recordFailure(node, trigger.failure ?? "unknown", trigger.error, trigger.retries)
      continue
    }
    await progress(`${id}: parent resumed`)
    const handoffsForParent = handoffs.filter((item) => item.parentID === id && item.delivered)
    for (const item of handoffsForParent) item.parentResumed = true
    await completeNode(node, trigger.result.summary, undefined, trigger.retries)
    if (role === "root") rootReactivated = true
  }

  const resumable = stoppedBy === "max-duration" || stoppedBy === "cancelled" || actions.some((action) => action.action === "blocked-network" || action.action === "blocked-timeout" || action.action === "blocked-barrier" || action.action === "pending")
  return report({
    rootId,
    rootReactivated,
    ...(stoppedBy ? { stoppedBy } : {}),
    ...(resumable ? { resumable: true, note: stoppedBy === "max-duration" ? "Maximum duration reached; rerun to continue from journaled completions." : "Some nodes remain unresolved; rerun after addressing the reported blockers." } : {}),
  })
}
