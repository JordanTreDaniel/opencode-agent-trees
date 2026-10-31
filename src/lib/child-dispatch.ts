const SESSION_ID = /\bses_[A-Za-z0-9_-]+\b/
const SESSION_KEYS = new Set(["sessionID", "sessionId", "session_id", "childID", "childId", "child_id"])

/**
 * Built-in child-dispatch result shapes are not a documented contract. Prefer
 * explicit session fields, then inspect bounded JSON/text content as a fallback.
 */
export function extractChildID(input: unknown, result?: unknown): string | undefined {
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: input, depth: 0 },
    { value: result, depth: 0 },
  ]
  const seen = new Set<object>()
  let scanned = 0

  while (queue.length && scanned++ < 300) {
    const { value, depth } = queue.shift()!
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          queue.push({ value: JSON.parse(trimmed), depth: depth + 1 })
        } catch {
          // Text may contain incidental braces; fall through to session-ID scan.
        }
      }
      const match = SESSION_ID.exec(value)
      if (match) return match[0]
      continue
    }
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) continue
    seen.add(value)
    const object = value as Record<string, unknown>

    // Prioritize explicit child/session fields over arbitrary nested strings.
    for (const [key, child] of Object.entries(object)) {
      if (SESSION_KEYS.has(key) && typeof child === "string" && SESSION_ID.test(child)) return child
    }
    for (const child of Object.values(object)) queue.push({ value: child, depth: depth + 1 })
  }
  return undefined
}
