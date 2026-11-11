#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { writeFileSync } from 'node:fs';

// Both paths are configurable: --cli / --db flags or OPENCHAMBER_CLI / OPENCODE_DB.
const DEFAULT_CLI = join(homedir(), '.local/share/openchamber/node_modules/@openchamber/web/bin/cli.js');
const DEFAULT_DB = join(homedir(), '.local/share/opencode/opencode.db');

function parseArgs(argv) {
  const options = {
    cli: process.env.OPENCHAMBER_CLI || DEFAULT_CLI,
    db: process.env.OPENCODE_DB || DEFAULT_DB,
    port: '3000',
    out: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') continue;
    if (arg === '--cli' || arg === '--db' || arg === '--port' || arg === '--out') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[{ '--cli': 'cli', '--db': 'db', '--port': 'port', '--out': 'out' }[arg]] = value;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/sidebar-view.mjs [--json] [--cli PATH] [--db PATH] [--port PORT] [--out FILE]');
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function runCli(cliPath, args) {
  const stdout = execFileSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(stdout);
}

function readDatabaseRows(dbPath, ids) {
  if (ids.length === 0) return { available: true, rows: new Map() };

  try {
    const rows = new Map();
    for (let start = 0; start < ids.length; start += 250) {
      const chunk = ids.slice(start, start + 250);
      const quotedIds = chunk.map((id) => `'${String(id).replaceAll("'", "''")}'`).join(',');
      const sql = `SELECT id, parent_id, idle_outcome, model, time_archived, metadata FROM session_v2 WHERE id IN (${quotedIds});`;
      const output = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
      });
      for (const row of JSON.parse(output || '[]')) rows.set(row.id, row);
    }
    return { available: true, rows };
  } catch (error) {
    return { available: false, rows: new Map(), error: error.message };
  }
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeModel(value) {
  const model = parseJsonValue(value);
  if (!model) return null;
  if (typeof model === 'string') return model;
  if (typeof model !== 'object') return String(model);
  const id = model.id || model.modelID || null;
  const provider = model.providerID || model.provider || null;
  if (provider && id) return `${provider}/${id}`;
  return id || provider || null;
}

function errorMessage(error) {
  const detail = error.stderr?.toString().trim() || error.message || String(error);
  return detail.slice(0, 1200);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectsResponse = runCli(options.cli, ['projects', '--json', '--port', options.port]);
  if (!Array.isArray(projectsResponse.projects)) {
    throw new Error('OpenChamber CLI projects response did not contain a projects array');
  }

  const projects = projectsResponse.projects.map((project) => ({
    name: project.label || project.name || basename(project.path || 'unknown'),
    path: project.path,
    sourceSessions: null,
  }));
  const allSessions = [];

  for (let index = 0; index < projectsResponse.projects.length; index += 1) {
    const project = projectsResponse.projects[index];
    try {
      const response = runCli(options.cli, [
        'session', 'list', '--json', '--with-status', '--limit', '5000',
        '--dir', project.path, '--port', options.port,
      ]);
      if (!Array.isArray(response.sessions)) {
        throw new Error('OpenChamber CLI session response did not contain a sessions array');
      }
      projects[index].sourceSessions = response.sessions;
      for (const session of response.sessions) allSessions.push({ projectIndex: index, session });
    } catch (error) {
      projects[index].error = errorMessage(error);
      projects[index].sessions = [];
      delete projects[index].sourceSessions;
    }
  }

  const database = readDatabaseRows(options.db, allSessions.map(({ session }) => session.id).filter(Boolean));
  const limitations = [
    'Pending questions and forms are unavailable: the read-only /api/sessions/status probe returned HTTP 401; unknown state is not treated as safe.',
    'The managed Chats category is not exposed by the CLI data used here, so chats are not separately classified.',
    'The In work flag reflects only metadata.openchamber.work.state === "open"; busy/idle status is not used to infer work state.',
  ];
  if (!database.available) {
    limitations.push(`SQLite cross-check unavailable (${database.error}); archived exclusion relies on the CLI default, and sessions without a CLI parentID are omitted because top-level status cannot be verified.`);
  }

  let databaseMissing = 0;
  for (const project of projects) {
    if (!project.sourceSessions) continue;
    project.sessions = [];
  }

  for (const { projectIndex, session } of allSessions) {
    if (!session.id) continue;
    const dbRow = database.rows.get(session.id);
    if (database.available) {
      if (!dbRow) {
        databaseMissing += 1;
        continue;
      }
      if (dbRow.parent_id !== null) continue;
      if (dbRow.time_archived !== null) continue;
    } else if (Object.hasOwn(session, 'parentID') ? session.parentID !== null : true) {
      continue;
    }

    // Use the database as an independent guard even when the CLI supplied a
    // null parentID; it must agree that this is a root session.
    if (Object.hasOwn(session, 'parentID') && session.parentID !== null) continue;
    const metadata = session.metadata ?? parseJsonValue(dbRow?.metadata) ?? null;
    const workState = metadata?.openchamber?.work?.state;
    const model = normalizeModel(session.model) || normalizeModel(dbRow?.model);
    const outcome = session.outcome ?? dbRow?.idle_outcome ?? null;
    const updated = session.time?.updated ?? null;

    projects[projectIndex].sessions.push({
      id: session.id,
      title: session.title || '(untitled)',
      status: session.status?.type || session.status || 'unknown',
      outcome,
      model,
      updatedAt: updated === null ? null : new Date(updated).toISOString(),
      url: `http://localhost:${options.port}/dashboard?session=${encodeURIComponent(session.id)}`,
      workOpen: workState === undefined ? null : workState === 'open',
    });
  }

  if (databaseMissing > 0) {
    limitations.push(`${databaseMissing} CLI session(s) had no matching session_v2 row and were omitted because parent/archive status could not be verified.`);
  }

  for (const project of projects) {
    delete project.sourceSessions;
    project.sessions.sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0));
  }

  const byStatus = {};
  let sessionCount = 0;
  for (const project of projects) {
    for (const session of project.sessions) {
      sessionCount += 1;
      byStatus[session.status] = (byStatus[session.status] || 0) + 1;
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    source: `OpenChamber CLI (${options.cli}); SQLite read-only (${options.db}${database.available ? '' : ', unavailable'})`,
    projects,
    counts: { projects: projects.length, sessions: sessionCount, byStatus },
    limitations,
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.out) writeFileSync(options.out, json, 'utf8');
  else process.stdout.write(json);
}

try {
  main();
} catch (error) {
  console.error(`sidebar-view: ${errorMessage(error)}`);
  process.exitCode = 1;
}
