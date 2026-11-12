#!/usr/bin/env node

// Resume paused sessions from their durable pause records.
//
// Resume is DETERMINISTIC: the reply to a pending form resolves the engine's
// Deferred and the same turn continues — no new prompt, no second billing.
// Outcomes reported honestly:
//   resumed     — the reply was accepted AND the form left the pending set
//                 (the session left question-paused).
//   stale-form  — the form died (pending forms live in engine RAM and do not
//                 survive an engine restart). A reply cannot revive it;
//                 resuming needs a NEW paid turn — say so and send a fresh
//                 prompt (tree.wake), do not pretend the reply worked.
//   not-paused  — no pause record exists for the target, or it was already
//                 resumed.
//
// DRY RUN IS THE DEFAULT: without --yes nothing is sent.

import { defaultPauseOutDir, listPauseRecords, readPauseRecord, resumeSession } from "../src/lib/pause.ts"

const USAGE = `Usage: node scripts/tree-resume.mjs (--session <id> | --root <id> | --all-recorded) [options]

Reads pause records written by tree-pause / tree.pause under <out>/pauses/.
Dry run is the DEFAULT: nothing is sent unless --yes is passed.

Options:
  --session <id>      Resume exactly this session's recorded pause.
  --root <id>         Every recorded pause in that session tree.
  --all-recorded      Every pause record on disk.
  --answer "..."      Override the recorded intended answer.
  --timeout <ms>      Grace period for the form to leave the pending set
                      after the reply (default 15000).
  --dry-run           Print what would be replied; send nothing (default).
  --yes               Actually send the replies.
  --json              Machine-readable output.
  --out <dir>         Pause record directory (default: $AGENT_TREES_DATA_DIR,
                      else $XDG_DATA_HOME/opencode-agent-trees, else
                      ~/.local/share/opencode-agent-trees).
  --host <url>        OpenChamber host (default: $OPENCHAMBER_HOST or
                      http://localhost:3000).
  -h, --help          Print this help.`

function fail(message) {
  process.stderr.write(`tree-resume: ${message}\n`)
  process.exitCode = 1
  return null
}

function parseArgs(argv) {
  const options = {
    session: null,
    root: null,
    allRecorded: false,
    answer: null,
    timeout: 15000,
    dryRun: true,
    json: false,
    out: null,
    host: process.env.OPENCHAMBER_HOST || null,
  }

  const valueFlags = new Map([
    ["--session", "session"],
    ["--root", "root"],
    ["--answer", "answer"],
    ["--timeout", "timeout"],
    ["--out", "out"],
    ["--host", "host"],
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "-h" || arg === "--help") return { help: true }
    if (arg === "--json") { options.json = true; continue }
    if (arg === "--yes") { options.dryRun = false; continue }
    if (arg === "--dry-run") { options.dryRun = true; continue }
    if (arg === "--all-recorded") { options.allRecorded = true; continue }
    const key = valueFlags.get(arg)
    if (!key) throw new Error(`unknown argument: ${arg}`)
    const value = argv[++index]
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`)
    if (key === "timeout") {
      if (!/^\d+$/.test(value)) throw new Error(`${arg} must be a non-negative integer`)
      options.timeout = Number(value)
      continue
    }
    options[key] = value
  }

  const selectors = [options.session, options.root, options.allRecorded].filter(Boolean)
  if (selectors.length === 0) throw new Error("choose a target: --session <id>, --root <id>, or --all-recorded")
  if (selectors.length > 1) throw new Error("pass exactly one of --session, --root, --all-recorded")
  return options
}

function pad(text, width) {
  const value = String(text)
  return value.length >= width ? value + " ".repeat(width - value.length) : value.slice(0, width)
}

async function selectRecords(options) {
  if (options.session) {
    const record = await readPauseRecord(options.out, options.session)
    return record ? [record] : null // null = no record at all
  }
  const all = await listPauseRecords(options.out)
  if (options.root) {
    return all.filter((record) => record.treeRoot === options.root || record.sessionId === options.root)
  }
  return all
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
  options.out = options.out ?? defaultPauseOutDir()

  const records = await selectRecords(options)
  const results = []

  if (records === null) {
    results.push({
      sessionId: options.session,
      outcome: "not-paused",
      detail: `no pause record under ${options.out}/pauses/ for this session`,
    })
  } else if (records.length === 0) {
    results.push({
      sessionId: options.root ?? "-",
      outcome: "not-paused",
      detail: `no pause records matched under ${options.out}/pauses/`,
    })
  }

  for (const record of records ?? []) {
    if (record.resumedAt) {
      results.push({
        sessionId: record.sessionId,
        formId: record.formId,
        outcome: "not-paused",
        detail: `already resumed at ${record.resumedAt}`,
      })
      continue
    }
    const answer = options.answer ?? record.intendedAnswer
    if (!answer) {
      results.push({
        sessionId: record.sessionId,
        formId: record.formId,
        outcome: "skipped",
        detail: "no answer available: the record stores no intendedAnswer and --answer was not passed",
      })
      continue
    }
    if (options.dryRun) {
      results.push({
        sessionId: record.sessionId,
        formId: record.formId,
        outcome: "dry-run",
        detail: `would reply to form ${record.formId} with ${JSON.stringify(answer)}`,
        askedAt: record.askedAt,
      })
      continue
    }
    const result = await resumeSession({
      sessionId: record.sessionId,
      formId: record.formId,
      answer,
      timeoutMs: options.timeout,
      ...(options.out ? { outDir: options.out } : {}),
      ...(options.host ? { host: options.host } : {}),
    })
    results.push({
      sessionId: record.sessionId,
      formId: record.formId,
      outcome: result.status,
      detail: result.detail,
      waitedMs: result.waitedMs,
    })
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ mode: options.dryRun ? "dry-run" : "send", outDir: options.out, results }, null, 2)}\n`,
    )
  } else {
    const lines = []
    lines.push(options.dryRun ? "mode: DRY RUN — nothing was sent (pass --yes to send)" : "mode: SEND — replies were posted and verified individually")
    lines.push(`records: ${options.out}/pauses`)
    lines.push("")
    lines.push(`${pad("SESSION", 34)} ${pad("FORM", 34)} ${pad("OUTCOME", 12)} DETAIL`)
    for (const result of results) {
      lines.push(`${pad(result.sessionId, 34)} ${pad(result.formId ?? "-", 34)} ${pad(result.outcome, 12)} ${result.detail}`)
    }
    const resumed = results.filter((result) => result.outcome === "resumed").length
    const stale = results.filter((result) => result.outcome === "stale-form").length
    lines.push("")
    lines.push(`totals: ${resumed} resumed, ${stale} stale-form, ${results.length - resumed - stale} other, ${results.length} record(s)`)
    if (stale > 0) {
      lines.push("stale-form means the form died; resuming needs a NEW paid turn (send a fresh prompt), not a reply")
    }
    process.stdout.write(`${lines.join("\n")}\n`)
  }

  const bad = results.filter((result) => ["stale-form", "error"].includes(result.outcome))
  if (bad.length > 0) process.exitCode = 1
}

await main()
