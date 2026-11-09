// The handoff message is the artifact a parent actually reads. Keep the shape
// stable: parents, tests, and humans all pattern-match on it.
//
//   Agent-tree handoff from <reporterID>: child <childID> (parent <parentID>) <finished|died>.
//   Here is what it reported: <summary>. Note: <note>

export interface HandoffInput {
  reporterID: string
  childID: string
  parentID: string
  outcome: "finished" | "died"
  summary: string
  note?: string | undefined
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, "")
  return trimmed.length ? `${trimmed}.` : ""
}

export function formatHandoff(input: HandoffInput): string {
  const parts = [
    `Agent-tree handoff from ${input.reporterID}: child ${input.childID} (parent ${input.parentID}) ${input.outcome}.`,
    `Here is what it reported: ${sentence(input.summary)}`,
  ]
  if (input.note && input.note.trim().length) parts.push(`Note: ${sentence(input.note)}`)
  return parts.join(" ")
}

/** Maps an OpenCode session outcome onto the two words a parent cares about. */
export function outcomeWord(outcome: string | undefined): "finished" | "died" {
  return outcome === "succeeded" ? "finished" : "died"
}
