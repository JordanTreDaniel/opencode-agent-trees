// Test doubles for the plugin context. These implement ONLY the surface the
// library code touches, so the unit tests never need a live OpenCode server.
import type { FamilyDeps, SessionLike } from "../src/lib/family.ts"

export interface FakeStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    entries: readonly { key: string; value: unknown }[]
    next?: string
  }>
  keys(): string[]
}

export function makeFakeStorage(): FakeStorage {
  const data = new Map<string, unknown>()
  // A clone on write and on read makes a lost update visible to the tests,
  // exactly like a real store that serialises through JSON.
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
  return {
    async get(key) {
      return data.has(key) ? clone(data.get(key)) : undefined
    },
    async set(key, value) {
      // Yield so concurrent read-modify-write races actually interleave.
      await new Promise((r) => setTimeout(r, 0))
      data.set(key, clone(value))
    },
    async remove(key) {
      data.delete(key)
    },
    async scan({ prefix, after, limit }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort()
      const start = after ? keys.indexOf(after) + 1 : 0
      const slice = keys.slice(start, limit ? start + limit : undefined)
      return {
        entries: slice.map((key) => ({ key, value: clone(data.get(key)) })),
        ...(limit && keys.length > start + limit ? { next: slice[slice.length - 1] } : {}),
      }
    },
    keys() {
      return [...data.keys()].sort()
    },
  }
}

export interface FakeCtx {
  storage: FakeStorage
  deps: FamilyDeps
  get(id: string): SessionLike | undefined
}

export function makeFakeCtx(): FakeCtx {
  const sessions = new Map<string, SessionLike>()
  const storage = makeFakeStorage()
  return {
    storage,
    get: (id) => sessions.get(id),
    deps: {
      get: async (id) => sessions.get(id),
      listChildren: async (parentID) => [...sessions.values()].filter((s) => s.parentID === parentID),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ sessions } as any),
  }
}

export function seedFamily(
  ctx: FakeCtx,
  sessions: Record<string, Omit<SessionLike, "id">>,
): void {
  const map = (ctx as unknown as { sessions: Map<string, SessionLike> }).sessions
  for (const [id, value] of Object.entries(sessions)) {
    map.set(id, { id, ...value } as SessionLike)
  }
}

