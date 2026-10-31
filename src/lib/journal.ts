// Durable per-session journal. One storage key per session: `journal:<sessionID>`.
//
// Safety under concurrency: `appendEntry` performs the whole read-modify-write
// inside a per-key in-process critical section, so N concurrent appends from
// tool calls, hooks, and nested tools in the same server process cannot lose a
// write. Cross-process safety is NOT provided by ctx.storage (no CAS primitive);
// see README "known limitations".

export const JOURNAL_PREFIX = "journal:"

export interface StorageLike {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

export interface JournalEntry {
  seq: number
  at: number
  kind: string
  sessionID: string
  [key: string]: unknown
}

export type EntryInput = { kind: string } & Record<string, unknown>

const chains = new Map<string, Promise<unknown>>()

function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  // Keep the chain alive but never let a rejection poison the next waiter.
  chains.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

export function journalKey(sessionID: string): string {
  return `${JOURNAL_PREFIX}${sessionID}`
}

function asEntries(value: unknown): JournalEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is JournalEntry => !!entry && typeof entry === "object")
}

export async function appendEntry(
  storage: StorageLike,
  sessionID: string,
  input: EntryInput,
): Promise<JournalEntry> {
  const key = journalKey(sessionID)
  return withKeyLock(key, async () => {
    const existing = asEntries(await storage.get(key))
    const entry = {
      ...input,
      seq: existing.length + 1,
      at: Date.now(),
      sessionID,
    } as JournalEntry
    await storage.set(key, [...existing, entry])
    return entry
  })
}

export async function readJournal(storage: StorageLike, sessionID: string): Promise<JournalEntry[]> {
  return asEntries(await storage.get(journalKey(sessionID)))
}
