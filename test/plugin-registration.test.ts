import test from "node:test"
import assert from "node:assert/strict"

import plugin from "../src/index.ts"
import { makeFakeCtx } from "./fake-ctx.ts"

test("missing recovery APIs produce a truthful startup log with the omission reason", async () => {
  const fixture = makeFakeCtx()
  const registered: Array<Record<string, unknown>> = []
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")) }
  try {
    const context = {
      app: { version: "2.1.2" },
      storage: fixture.storage,
      session: {
        get: async () => undefined,
        list: async () => ({ data: [], cursor: {} }),
        prompt: async () => ({}),
        hook: async () => ({ dispose: async () => {} }),
      },
      tool: {
        transform: async (callback: (editor: { namespace(): void; add(tool: Record<string, unknown>): void }) => void) => {
          callback({ namespace() {}, add(tool) { registered.push(tool) } })
        },
        hook: async () => ({ dispose: async () => {} }),
      },
    }

    await plugin.setup(context as never)
  } finally {
    console.log = originalLog
  }

  assert.equal(registered.some((tool) => tool.name === "recover"), false)
  assert.match(logs.join("\n"), /recover omitted.*ctx\.session\.wait.*ctx\.session\.context/i)
  assert.doesNotMatch(logs.join("\n"), /tools: [^;]*tree\.recover/)
})
