#!/usr/bin/env node

// Human/JSON front end for the views layer. All projection logic lives in
// ../src/lib/status.ts so the CLI, the plugin tool and the docs share one
// implementation; all view and filter definitions live in ../src/lib/views.json.
//
// Auth: when the host needs a session cookie, the projection reads the host
// runfile (~/.config/openchamber/run/openchamber-<port>.json) in-process. This
// script never prints a password, never puts a secret in argv, and never reads
// startup.env.

const USAGE = `Usage: node scripts/tree-status.mjs [options]

Options:
  --view <name>        Named view (default: default). Accepts default, running,
                       needs-restart, question-paused, tree:<rootId>, subtree:<id>.
  --root <sessionID>   Bind the tree view to a root session.
  --subtree <sessionID> Bind the subtree view to a session (self-inclusive).
  --json               Print the full projection instead of a table.
  --limit <n>          Inventory cap (default: 2000).
  --all                Ignore the inventory cap; page every session.
  --db <path>          Session database (default: $OPENCODE_DB, else
                       $XDG_DATA_HOME/opencode/opencode.db, else ~/.local/share/opencode/opencode.db).
  --host <url>         OpenChamber host (default: $OPENCHAMBER_HOST or http://localhost:3000).
                       Pass "off" to skip the host and read the database only.
  --max-rows <n>       Table rows to print (default: 40; --json is unlimited).
  --timeout <ms>       Host request timeout (default: 2000).
  -h, --help           Print this help.`

function fail(message) {
  process.stderr.write(`tree-status: ${message}\n`)
  process.exitCode = 1
  return null
}

function parseArgs(argv) {
  const options = {
    view: "default",
    root: null,
    subtree: null,
    json: false,
    limit: null,
    all: false,
    db: process.env.OPENCODE_DB || null,
    host: process.env.OPENCHAMBER_HOST || null,
    maxRows: 40,
    timeout: null,
  }

  const valueFlags = new Map([
    ["--view", "view"],
    ["--root", "root"],
    ["--subtree", "subtree"],
    ["--limit", "limit"],
    ["--db", "db"],
    ["--host", "host"],
    ["--max-rows", "maxRows"],
    ["--timeout", "timeout"],
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "-h" || arg === "--help") return { help: true }
    if (arg === "--json") { options.json = true; continue }
    if (arg === "--all") { options.all = true; continue }
    const key = valueFlags.get(arg)
    if (!key) throw new Error(`unknown argument: ${arg}`)
    const value = argv[++index]
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`)
    if (key === "view") options.viewGiven = true
    if (["limit", "maxRows", "timeout"].includes(key)) {
      if (!/^\d+$/.test(value)) throw new Error(`${arg} must be a non-negative integer`)
      options[key] = Number(value)
      continue
    }
    options[key] = value
  }

  if (options.all) options.limit = null
  if (!options.all && options.limit === null) options.limit = undefined
  if (options.host === "off" || options.host === "none") options.host = false
  // `--root` / `--subtree` select the matching view unless --view said otherwise,
  // so the flags are never silently ignored.
  if (!options.viewGiven) {
    if (options.subtree) options.view = "subtree"
    else if (options.root) options.view = "tree"
  }
  return options
}

function formatAge(epochMs, now) {
  if (epochMs === null || epochMs === undefined) return "-"
  const delta = Math.max(0, now - epochMs)
  const minutes = Math.round(delta / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

function pad(text, width) {
  const value = String(text)
  return value.length >= width ? value : value + " ".repeat(width - value.length)
}

function marks(session) {
  const out = []
  if (session.paused) out.push("QUESTION")
  if (session.hasPendingForm && !session.paused) out.push("form-no-turn")
  if (session.scheduled) out.push("scheduled")
  if (session.fork) out.push("fork")
  if (session.claimed) out.push("claimed")
  if (session.archived) out.push("archived")
  if (session.outcome) out.push(session.outcome)
  return out.join(",")
}

function renderTable(projection, options, label) {
  const now = Date.parse(projection.meta.capturedAt)
  const membership = projection.views[label] ?? { count: 0, ids: [] }
  const ids = new Set(membership.ids ?? [])
  const rows = projection.sessions.filter((session) => ids.has(session.id))

  const lines = []
  lines.push(`view: ${label}  rows: ${rows.length}/${projection.sessions.length} scanned  source: ${projection.meta.source}`)
  if (projection.meta.stale) lines.push("stale: true — the host live state was unavailable, so status and pending forms are DB-derived only")

  if (rows.length === 0) {
    lines.push("")
    lines.push("no sessions match this view")
  } else {
    const shown = options.maxRows > 0 ? rows.slice(0, options.maxRows) : rows
    lines.push("")
    lines.push(
      `${pad("STATUS", 8)} ${pad("DEPTH", 5)} ${pad("ACTIVITY", 11)} ${pad("ID", 34)} ${pad("TITLE", 46)} MARKS`,
    )
    for (const session of shown) {
      lines.push(
        `${pad(session.status, 8)} ${pad(session.depth, 5)} ${pad(formatAge(session.lastActivity, now), 11)} ` +
          `${pad(session.id, 34)} ${pad((session.title ?? "(untitled)").slice(0, 46), 46)} ${marks(session)}`,
      )
    }
    if (shown.length < rows.length) {
      lines.push("")
      lines.push(`… ${rows.length - shown.length} more row(s) — raise --max-rows or use --json`)
    }
  }

  lines.push("")
  lines.push(
    `scanned ${projection.meta.scanned} of ${projection.meta.inventoryTotal ?? "?"} session(s)` +
      (projection.meta.truncated ? ` (capped at ${projection.meta.inventoryLimit}; --all for every session)` : ""),
  )
  for (const warning of projection.meta.warnings ?? []) lines.push(`warning: ${warning}`)
  return `${lines.join("\n")}\n`
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

  let projectStatus
  try {
    ;({ projectStatus } = await import("../src/lib/status.ts"))
  } catch (error) {
    fail(`cannot load the projection engine (Node 22+ with TypeScript type stripping required): ${error.message}`)
    return
  }

  const input = {
    view: options.view,
    ...(options.root ? { rootId: options.root } : {}),
    ...(options.subtree ? { subtreeOf: options.subtree } : {}),
    ...(options.limit === null ? { all: true } : options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.db ? { dbPath: options.db } : {}),
    ...(options.host === false ? { host: false } : options.host ? { host: options.host } : {}),
    ...(options.timeout === null ? {} : { timeoutMs: options.timeout }),
  }

  let projection
  try {
    projection = await projectStatus(input)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return
  }

  const label = projection.meta.view
  if (projection.views[label]?.skipped) {
    fail(`${label}: ${projection.views[label].skipped}`)
    return
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`)
    return
  }

  process.stdout.write(renderTable(projection, options, label))
  if (projection.meta.stale) process.exitCode = 0
}

await main()
