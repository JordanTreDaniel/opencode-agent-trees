import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const catalogPath = resolve(repoRoot, "docs/features/features.json")
const outputPath = resolve(repoRoot, "docs/features/recursive-wake-up.md")

function quoteBlock(value) {
  return value.split("\n").map((line) => `> ${line}`).join("\n")
}

function labeledNote(notes, label) {
  const index = notes.findIndex((note) => note.startsWith(label) && note.includes(":"))
  if (index < 0) return undefined
  return { index, text: notes[index].slice(notes[index].indexOf(":") + 1).trim() }
}

export async function renderWakeUp(sourcePath = catalogPath) {
  const catalog = JSON.parse(await readFile(sourcePath, "utf8"))
  const feature = catalog.find((item) => item.id === "F-01")
  if (!feature) throw new Error("features.json has no F-01 record")

  const notes = [...(feature.notes ?? [])]
  const statusNote = labeledNote(notes, "Implementation status")
  const inputsNote = labeledNote(notes, "Inputs")
  const coordinatorNote = labeledNote(notes, "Coordinator scope")
  const terminationNote = labeledNote(notes, "Termination condition")
  const postmortemNote = labeledNote(notes, "Why this was lost")
  const consumed = new Set([statusNote, inputsNote, coordinatorNote, terminationNote, postmortemNote].filter(Boolean).map((item) => item.index))
  const algorithm = [...(feature.algorithm ?? [])].sort((a, b) => a.order - b.order)
  const specified = algorithm.filter((step) => step.basis === "specified")
  const inferred = algorithm.filter((step) => step.basis === "inferred")
  const proofItems = feature.criteria?.items ?? []
  const lines = [
    `# ${feature.id} — ${feature.title}`,
    "",
    `> **Status:** ${feature.status}; lifecycle: ${feature.lifecycle}.`,
  ]

  if (statusNote) lines.push(`> ${notes[statusNote.index]}`)
  lines.push(
    "",
    "This page is generated from [`features.json`](./features.json) (the canonical F-01 record) by `node scripts/render-wake-up.mjs`. The JSON Schema is [`schema.json`](./schema.json).",
    "",
    "## Intent",
    "",
    quoteBlock(feature.provenance.quote),
    "",
    `Source: \`${feature.provenance.messageId}\`.`,
    "",
    `**User outcome:** ${feature.story}`,
  )

  const scenarios = feature.validation?.scenarios ?? []
  if (scenarios.length) {
    lines.push("", ...scenarios.flatMap((scenario) => [
      `**${scenario.name}.** Given ${scenario.given} When ${scenario.when} Then ${scenario.then}`,
    ]))
  }

  lines.push("", "## Inputs", "")
  for (const input of feature.routine?.inputs ?? []) lines.push(`- ${input}`)
  if (inputsNote) lines.push(`- ${inputsNote.text}`)

  lines.push(
    "",
    "## Recovery routine",
    "",
    "Specified behavior is supported by a source message ID and verbatim quote. Inferred behavior, if present, is separated and remains subject to confirmation.",
    "",
    "### Specified behavior",
    "",
  )
  for (const step of specified) {
    lines.push(
      `${step.order}. **Specified** — ${step.text}`,
      `   - Source: \`${step.provenance.messageId}\``,
      "   - Verbatim:",
      `     ${quoteBlock(step.provenance.quote).replaceAll("\n", "\n     ")}`,
      "",
    )
  }

  if (inferred.length) {
    lines.push("### Inferred behavior", "")
    for (const step of inferred) lines.push(`${step.order}. **Inferred** — ${step.text}`, "")
  }

  if (coordinatorNote) lines.push("### Scope of unresolved mechanics", "", coordinatorNote.text, "")
  lines.push("### Open questions", "")
  for (const ambiguity of feature.ambiguities ?? []) lines.push(`- ${ambiguity}`)

  if (terminationNote) lines.push("", "## Termination condition", "", terminationNote.text)
  if (postmortemNote) lines.push("", "## Why this was lost", "", postmortemNote.text)

  lines.push("", "## Proof status", "")
  for (const item of proofItems) lines.push(`- \`${item.id}\` — ${item.description} **${item.status}**.`)
  if (feature.criteria?.linkage) lines.push(`- ${feature.criteria.linkage}`)
  if (feature.criteria?.engineRef) {
    const { taskId, criteriaPath } = feature.criteria.engineRef
    lines.push(`- Engine reference: task ID ${taskId ?? "not assigned"}; criteria path ${criteriaPath ?? "not assigned"}.`)
  }

  const remainingNotes = notes.filter((_note, index) => !consumed.has(index))
  if (remainingNotes.length) {
    lines.push("", "## Record notes", "")
    for (const note of remainingNotes) lines.push(`- ${note}`)
  }

  return `${lines.join("\n").trimEnd()}\n`
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ""
if (invokedPath === import.meta.url) {
  const rendered = await renderWakeUp()
  if (process.argv.includes("--stdout")) process.stdout.write(rendered)
  else await writeFile(outputPath, rendered, "utf8")
}
