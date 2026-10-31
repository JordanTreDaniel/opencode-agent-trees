import test from "node:test"
import assert from "node:assert/strict"

import { extractChildID } from "../src/lib/child-dispatch.ts"

test("extractChildID reads common child session fields from tool input", () => {
  assert.equal(extractChildID({ sessionID: "ses_child123" }), "ses_child123")
  assert.equal(extractChildID({ task: { child_id: "ses_child456" } }), "ses_child456")
})

test("extractChildID reads child id from tool result JSON and text", () => {
  assert.equal(extractChildID(undefined, { session: { id: "ses_result123" } }), "ses_result123")
  assert.equal(
    extractChildID(undefined, { message: "Subagent failed (sessionID: ses_error123): provider failed" }),
    "ses_error123",
  )
  assert.equal(extractChildID(undefined, { content: "Child session: ses_text123 completed" }), "ses_text123")
  assert.equal(
    extractChildID(undefined, { content: [{ type: "text", text: '{"childID":"ses_nested123"}' }] }),
    "ses_nested123",
  )
})

test("extractChildID does not mistake arbitrary strings for session ids", () => {
  assert.equal(extractChildID({ text: "not a session" }, { output: { message: "done" } }), undefined)
})
