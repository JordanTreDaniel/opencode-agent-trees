#!/usr/bin/env node

// Pause sessions by prompt injection, with honest per-target outcomes.
//
// Pause is NOT an API: there is no blocking form endpoint. This script sends
// the target a prompt asking it to call the `question` tool, then waits for a
// NEW pending form plus the execution claim to be observed together. Only an
// observed pause is reported `paused`; a prompt the model did not act on is
// `ignored`, a deadline hit without evidence is `timeout`, and every refusal
// is `skipped(reason)`.
//
// DRY RUN IS THE DEFAULT: without --yes this script prints exactly which sessions
// would be prompted and with what text, and sends nothing.
//
// Auth: the projection/pause layer reads the host runfile in-process. This
// script never prints a password and never puts a secret in argv.

import {
  buildPausePrompt,
  guardPauseTarget,
  listPaused,
  pauseSession,
} from "../src/lib/pause.ts"

const USAGE = `Usage: node scripts/tree-pause.mjs (--session <id> | --view <name> | --root <id>) [options]

Target selection reuses the views layer (src/lib/views.json). Dry run is the
DEFAULT: nothing is sent unless --yes is passed.

Options:
  --session <id>      Pause exactly this session (must be in the inventory).
  --view <name>       Named view (running, question-paused, tree:<rootId>, ...).
  --root <id>         Every session in one tree (implies --view tree).
  --leaves-only       Leaves only (DEFAULT; kept explicit for readability).
  --allow-non-leaf    Also pause sessions that have children.
  --question "..."    The question the target must ask via the question tool.
  --answer "..."      Intended default answer, stored in the pause record for
                      tree-resume. Default: none.
  --timeout <ms>      Wait for form + claim per target (default 120000).
  --dry-run           Print the plan and the exact prompt text; send nothing
                      (this is the default; the flag is accepted for symmetry).
  --yes               Actually send the pause prompts.
  --json              Machine-readable output (implies nothing; combine with
                      --dry-run or --yes).
  --all               Page the whole session inventory instead of the default
                      2000-row cap (needed to find older sessions).
  --out <dir>         Pause record directory (default: $AGENT_TREES_DATA_DIR,
                      else $XDG_DATA_HOME/opencode-agent-trees, else
                      ~/.local/share/opencode-agent-trees).
  --db <path>         Session database (default: $OPENCODE_DB, else
                      $XDG_DATA_HOME/opencode/opencode.db, else
                      ~/.local/share/opencode/opencode.db).
  --host <url>        OpenChamber host (default: $OPENCHAMBER_HOST or
                      http://localhost:3000).
  -h, --help          Print this help.`

const DEFAULT_QUESTION = "Should this session stay paused here until explicitly resumed?"

function fail(message) {
  process.stderr.write(`tree-pause: ${message}\n`)
  process.exitCode = 1
  return null
}

function parseArgs(argv) {
  const options = {
    session: null,
    view: null,
    root: null,
    allowNonLeaf: false,
    question: DEFAULT_QUESTION,
    questionGiven: false,
    answer: null,
    timeout: 120000,
    dryRun: true,
    json: false,
    all: false,
    out: null,
    db: process.env.OPENCODE_DB || null,
    host: process.env.OPENCHAMBER_HOST || null,
  }

  const valueFlags = new Map([
    ["--session", "session"],
    ["--view", "view"],
    ["--root", "root"],
    ["--question", "question"],
    ["--answer", "answer"],
    ["--timeout", "timeout"],
    ["--out", "out"],
    ["--db", "db"],
    ["--host", "host"],
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "-h" || arg === "--help") return { help: true }
    if (arg === "--json") { options.json = true; continue }
    if (arg === "--all") { options.all = true; continue }
    if (arg === "--yes") { options.dryRun = false; continue }
    if (arg === "--dry-run") { options.dryRun = true; continue }
    if (arg === "--allow-non-leaf") { options.allowNonLeaf = true; continue }
    if (arg === "--leaves-only") { options.allowNonLeaf = false; continue }
    const key = valueFlags.get(arg)
    if (!key) throw new Error(`unknown argument: ${arg}`)
    const value = argv[++index]
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`)
    if (key === "timeout") {
      if (!/^\d+$/.test(value)) throw new Error(`${arg} must be a non-negative integer`)
      options.timeout = Number(value)
      continue
    }
    if (key === "question") options.questionGiven = true
    options[key] = value
  }

  const selectors = [options.session, options.view, options.root].filter(Boolean)
  if (selectors.length === 0) {
    throw new Error("choose a target: --session <id>, --view <name>, or --root <id>")
  }
  if (options.session && (options.view || options.root)) {
    throw new Error("--session cannot be combined with --view/--root")
  }
  return options
}

function pad(text, width) {
  const value = String(text)
  return value.length >= width ? value + " ".repeat(width - value.length) : value.slice(0, width)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    fail(error.message)
    process.stderr.write(`${USAGE}\n`)
    return
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }

  const view = options.view ?? (options.root ? "tree" : `subtree:${options.session}`)
  let projection
  try {
    projection = await listPaused({
      view,
      ...(options.root ? { rootId: options.root } : {}),
      ...(options.all ? { all: true } : {}),
      ...(options.db ? { dbPath: options.db } : {}),
      ...(options.host ? { host: options.host } : {}),
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return
  }

  const label = projection.meta.view
  const membership = projection.views[label] ?? { count: 0, ids: [] }
  if (membership.skipped) {
    fail(`${label}: ${membership.skipped}`)
    return
  }
  const wanted = new Set(membership.ids)
  const rows = projection.sessions.filter((session) => wanted.has(session.id))

  if (options.session && rows.length === 0) {
    fail(
      `session ${options.session} is not in the scanned inventory ` +
        `(${projection.meta.scanned} of ${projection.meta.inventoryTotal ?? "?"} rows read; pass --all to page the whole inventory, or check the id)`,
    )
    return
  }

  const liveKnown = projection.meta.stale === false
  const results = []
  for (const row of rows) {
    const guard = guardPauseTarget(row, { allowNonLeaf: options.allowNonLeaf, liveKnown })
    if (!guard.ok) {
      results.push({ sessionId: row.id, outcome: "skipped", detail: guard.reason })
      continue
    }
    if (options.dryRun) {
      results.push({
        sessionId: row.id,
        outcome: "dry-run",
        detail: `would prompt (timeout ${options.timeout}ms; answer for resume: ${options.answer === null ? "none" : JSON.stringify(options.answer)})`,
        treeRoot: row.rootId,
      })
      continue
    }
    const result = await pauseSession({
      sessionId: row.id,
      question: options.question,
      defaultAnswer: options.answer,
      timeoutMs: options.timeout,
      treeRoot: row.rootId,
      ...(options.out ? { outDir: options.out } : {}),
      ...(options.db ? { dbPath: options.db } : {}),
      ...(options.host ? { host: options.host } : {}),
    })
    results.push({
      sessionId: row.id,
      outcome: result.status,
      detail: result.detail,
      ...(result.formId ? { formId: result.formId } : {}),
      waitedMs: result.waitedMs,
      treeRoot: row.rootId,
    })
  }

  const promptText = buildPausePrompt(options.question)

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: options.dryRun ? "dry-run" : "send",
          question: options.question,
          prompt: promptText,
          view: label,
          liveKnown,
          results,
        },
        null,
        2,
      )}\n`,
    )
  } else {
    const lines = []
    lines.push(
      options.dryRun
        ? "mode: DRY RUN — nothing was sent (pass --yes to send)"
        : "mode: SEND — pause prompts were injected and verified individually",
    )
    lines.push(`view: ${label}  targets: ${rows.length}  live pending-form source: ${liveKnown ? "read" : "UNAVAILABLE"}`)
    lines.push(`question: ${options.question}`)
    lines.push("")
    lines.push("prompt text that would be (was) sent to each target:")
    lines.push(promptText.split("\n").map((line) => `  | ${line}`).join("\n"))
    lines.push("")
    lines.push(`${pad("SESSION", 34)} ${pad("OUTCOME", 10)} DETAIL`)
    for (const result of results) {
      lines.push(`${pad(result.sessionId, 34)} ${pad(result.outcome, 10)} ${result.detail}`)
    }
    const paused = results.filter((result) => result.outcome === "paused").length
    const refused = results.filter((result) => result.outcome === "skipped").length
    const bad = results.filter((result) => ["ignored", "timeout", "errored"].includes(result.outcome))
    lines.push("")
    lines.push(`totals: ${paused} paused, ${refused} skipped, ${bad.length} not paused, ${results.length} target(s)`)
    if (!options.dryRun && bad.length > 0) {
      lines.push("note: no target is reported paused unless its form and execution claim were both observed")
    }
    process.stdout.write(`${lines.join("\n")}\n`)
  }

  const notPaused = results.filter((result) => ["ignored", "timeout", "errored"].includes(result.outcome))
  if (notPaused.length > 0) process.exitCode = 1
  if (!options.dryRun && results.length === 0) process.exitCode = 1
}

await main()
