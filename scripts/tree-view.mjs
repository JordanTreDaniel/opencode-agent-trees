#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Point this at your OpenCode session database. Override with --db or OPENCODE_DB.
// OpenCode follows the XDG data dir when it is set; the tilde path is a
// different instance on machines that set XDG_DATA_HOME.
const DEFAULT_DB =
  process.env.OPENCODE_DB ||
  (process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'opencode/opencode.db')
    : join(homedir(), '.local/share/opencode/opencode.db'));
const DEFAULT_MODEL = 'opencode-go/deepseek-v4.1-flash';
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const DASHBOARD = 'http://localhost:3000/dashboard?session=';
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // Older Node releases use the sqlite3 CLI fallback below.
}

function parseArgs(argv) {
  const options = { root: null, mode: 'restart', depth: null, db: DEFAULT_DB, pinModel: DEFAULT_MODEL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--json') {
      options.mode = 'json';
      continue;
    }
    if (['--root', '--mode', '--depth', '--db', '--pin-model'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--root') options.root = value;
      if (arg === '--mode') options.mode = value;
      if (arg === '--depth') {
        if (!/^\d+$/.test(value)) throw new Error('--depth must be a non-negative integer');
        options.depth = Number(value);
      }
      if (arg === '--db') options.db = value;
      if (arg === '--pin-model') options.pinModel = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.root) throw new Error('--root <sessionID> is required');
  if (!['full', 'restart', 'json'].includes(options.mode)) throw new Error('--mode must be full, restart, or json');
  if (options.depth === null) options.depth = options.mode === 'full' ? Infinity : 99;
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/tree-view.mjs --root <sessionID> [options]

Options:
  --root <sessionID>          Required root session
  --mode <full|restart|json>  Output mode (default: restart)
  --json                      Alias for --mode json
  --depth <N>                 Render N levels below the root (default: unlimited for full, 99 otherwise)
  --db <path>                 SQLite database (default: ${DEFAULT_DB})
  --pin-model <provider/model> Recovery model hint (default: ${DEFAULT_MODEL})`);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function queryDatabase(dbPath, rootId) {
  const treeSql = `
    WITH RECURSIVE subtree AS (
      SELECT id, parent_id, title, time_created, time_updated, time_idle,
             time_suspended, idle_outcome, metadata, 0 AS depth
      FROM session_v2 WHERE id = ?
      UNION ALL
      SELECT child.id, child.parent_id, child.title, child.time_created,
             child.time_updated, child.time_idle, child.time_suspended,
             child.idle_outcome, child.metadata, subtree.depth + 1
      FROM session_v2 AS child JOIN subtree ON child.parent_id = subtree.id
    )
    SELECT id, parent_id, title, time_created, time_updated, time_idle,
           time_suspended, idle_outcome, metadata, depth
    FROM subtree ORDER BY depth, time_created, id`;

  if (!DatabaseSync) return queryWithSqliteCli(dbPath, rootId, treeSql);

  let handle;
  try {
    handle = new DatabaseSync(dbPath, { readOnly: true });
    const sessions = handle.prepare(treeSql).all(rootId);
    if (sessions.length === 0) throw new Error(`Root session not found: ${rootId}`);
    const ids = sessions.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const messageSql = `
      SELECT session_id, type, seq, data FROM (
        SELECT session_id, type, seq, data,
               ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY seq DESC) AS recent_rank
        FROM session_message
        WHERE session_id IN (${placeholders})
          AND (type = 'idle' OR (type = 'assistant' AND (data LIKE '%question%' OR data LIKE '%form%')))
      ) WHERE type = 'idle' OR recent_rank <= 12
      ORDER BY session_id, seq`;
    const pendingSql = `SELECT session_id, type, data, delivery, time_created FROM session_pending WHERE session_id IN (${placeholders})`;
    const messages = handle.prepare(messageSql).all(...ids);
    const pending = handle.prepare(pendingSql).all(...ids);
    return { sessions, messages, pending };
  } finally {
    handle?.close();
  }
}

function queryWithSqliteCli(dbPath, rootId, treeSql) {
  const sql = treeSql.replace('WHERE id = ?', `WHERE id = ${sqlQuote(rootId)}`);
  const run = (query) => JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', dbPath, query], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000,
  }) || '[]');
  const sessions = run(sql);
  if (sessions.length === 0) throw new Error(`Root session not found: ${rootId}`);
  const ids = sessions.map((row) => sqlQuote(row.id)).join(',');
  const messages = run(`
    SELECT session_id, type, seq, data FROM (
      SELECT session_id, type, seq, data,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY seq DESC) AS recent_rank
      FROM session_message
      WHERE session_id IN (${ids})
        AND (type = 'idle' OR (type = 'assistant' AND (data LIKE '%question%' OR data LIKE '%form%')))
    ) WHERE type = 'idle' OR recent_rank <= 12 ORDER BY session_id, seq`);
  const pending = run(`SELECT session_id, type, data, delivery, time_created FROM session_pending WHERE session_id IN (${ids})`);
  return { sessions, messages, pending };
}

function parseJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeRows({ sessions, messages, pending }, now) {
  const nodes = new Map();
  for (const row of sessions) {
    nodes.set(row.id, {
      ...row,
      id: String(row.id),
      title: row.title || '(untitled)',
      outcome: row.idle_outcome || null,
      children: [],
      url: `${DASHBOARD}${encodeURIComponent(row.id)}`,
      errorClass: null,
      questionPaused: false,
      active: false,
      excludedReason: null,
      supersededReason: null,
    });
  }
  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id)) nodes.get(node.parent_id).children.push(node);
  }
  for (const node of nodes.values()) {
    node.children.sort((a, b) => Number(a.time_created) - Number(b.time_created) || a.id.localeCompare(b.id));
  }

  const messagesBySession = new Map();
  for (const row of messages) {
    const list = messagesBySession.get(row.session_id) || [];
    list.push(row);
    messagesBySession.set(row.session_id, list);
  }
  const pendingBySession = new Map();
  for (const row of pending) {
    const list = pendingBySession.get(row.session_id) || [];
    list.push(row);
    pendingBySession.set(row.session_id, list);
  }

  for (const node of nodes.values()) {
    const history = (messagesBySession.get(node.id) || []).sort((a, b) => Number(a.seq) - Number(b.seq));
    const lastIdleSeq = Math.max(-1, ...history.filter((item) => item.type === 'idle').map((item) => Number(item.seq)));
    for (const row of history) {
      const data = parseJson(row.data);
      if (row.type === 'idle' && data?.error?.type) node.errorClass = data.error.type;
      if (row.type === 'assistant' && Number(row.seq) > lastIdleSeq && containsRunningQuestionTool(data)) {
        node.questionPaused = true;
      }
    }
    if (!node.questionPaused) {
      node.questionPaused = (pendingBySession.get(node.id) || []).some((row) => {
        const type = String(row.type || '').toLowerCase();
        const data = `${row.type || ''} ${row.data || ''}`.toLowerCase();
        return /question|form/.test(type) && !/resolved|delivered|cancelled/.test(String(row.delivery || '').toLowerCase())
          || /"(?:tool|name)"\s*:\s*"(?:question|form)"/.test(data);
      });
    }
    const updated = Number(node.time_updated) || 0;
    node.active = !node.questionPaused && (
      (!node.outcome && !node.time_suspended)
      || (updated > 0 && now - updated >= 0 && now - updated < ACTIVE_WINDOW_MS)
    );
    if (node.questionPaused) node.excludedReason = 'question-paused';
    else if (node.active) node.excludedReason = 'active-or-recently-active';
  }

  return nodes;
}

function containsRunningQuestionTool(value) {
  if (Array.isArray(value)) return value.some(containsRunningQuestionTool);
  if (!value || typeof value !== 'object') return false;
  const name = String(value.tool || value.name || value.toolName || '').toLowerCase();
  const state = value.state || value.status || {};
  const status = typeof state === 'string' ? state : String(state.status || '');
  if (/^(question|form)$/.test(name) && status.toLowerCase() === 'running') return true;
  return Object.values(value).some(containsRunningQuestionTool);
}

function computePlan(nodes, rootId) {
  const root = nodes.get(rootId);
  if (!root) throw new Error(`Root session not found: ${rootId}`);
  const failed = new Set();
  const superseded = new Set();

  function classifyParent(parent) {
    const lastSuccess = parent.children
      .filter((child) => child.outcome === 'succeeded')
      .reduce((latest, child) => !latest || Number(child.time_created) > Number(latest.time_created) ? child : latest, null);
    for (const child of parent.children) {
      if (!isFailure(child)) continue;
      if (lastSuccess && Number(child.time_created) < Number(lastSuccess.time_created)) {
        child.supersededReason = `created before most recent succeeded child ${lastSuccess.id}`;
        superseded.add(child.id);
      } else {
        failed.add(child.id);
      }
    }
    for (const child of parent.children) classifyParent(child);
  }
  classifyParent(root);
  if (isFailure(root) && !root.excludedReason) failed.add(root.id);

  // Superseded work makes its whole subtree ineligible for restart, not just its failed root.
  function propagateSuperseded(node, inherited = false) {
    const inSupersededBranch = inherited || superseded.has(node.id);
    if (inSupersededBranch && isFailure(node)) {
      superseded.add(node.id);
      failed.delete(node.id);
      if (!node.supersededReason) node.supersededReason = 'descendant of a superseded session';
    }
    for (const child of node.children) propagateSuperseded(child, inSupersededBranch);
  }
  propagateSuperseded(root);

  // A paused/active session blocks restart planning for its descendants as well.
  function propagateExcluded(node, inheritedReason = null) {
    const blocked = inheritedReason || node.excludedReason;
    if (inheritedReason && isFailure(node)) node.excludedReason = `under-${inheritedReason}`;
    for (const child of node.children) propagateExcluded(child, blocked);
  }
  propagateExcluded(root);

  const restartCandidates = [...failed].filter((id) => !nodes.get(id).excludedReason);
  const hasFailedDescendant = new Map();
  function containsCandidateDescendant(node) {
    let found = false;
    for (const child of node.children) {
      const childHasFailure = containsCandidateDescendant(child);
      if (failed.has(child.id) || childHasFailure) found = true;
    }
    hasFailedDescendant.set(node.id, found);
    return found;
  }
  containsCandidateDescendant(root);
  const restartLeaves = new Set(restartCandidates.filter((id) => !hasFailedDescendant.get(id)));

  const ancestors = new Set();
  for (const leafId of restartLeaves) {
    let node = nodes.get(leafId);
    while (node?.parent_id && nodes.has(node.parent_id)) {
      node = nodes.get(node.parent_id);
      ancestors.add(node.id);
    }
  }
  for (const leafId of restartLeaves) ancestors.delete(leafId);

  const countDescendants = (node) => node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
  const allSucceeded = (node) => node.outcome === 'succeeded' && !node.excludedReason && node.children.every(allSucceeded);
  const counts = {
    nodesScanned: nodes.size,
    failed: [...failed].length,
    superseded: superseded.size,
    restartLeaves: restartLeaves.size,
    ancestors: ancestors.size,
    succeeded: [...nodes.values()].filter((node) => node.outcome === 'succeeded').length,
    questionPaused: [...nodes.values()].filter((node) => node.questionPaused).length,
    active: [...nodes.values()].filter((node) => node.active).length,
  };

  return { root, failed, superseded, restartLeaves, ancestors, counts, countDescendants, allSucceeded };
}

function isFailure(node) {
  return node.outcome === 'failed' || node.outcome === 'interrupted';
}

function markers(node, plan) {
  const result = [];
  if (node.excludedReason === 'question-paused') result.push('[QUESTION]');
  if (node.excludedReason === 'active-or-recently-active') result.push('[ACTIVE]');
  if (plan.superseded.has(node.id)) result.push('[SUPERSEDED]');
  else if (plan.failed.has(node.id)) result.push('[FAILED]');
  else if (node.outcome === 'succeeded') result.push('[SUCCEEDED]');
  if (plan.restartLeaves.has(node.id)) result.push('[RESTART LEAF]');
  else if (plan.ancestors.has(node.id)) result.push('[ANCESTOR]');
  return result;
}

function outcomeLabel(node) {
  if (node.excludedReason === 'question-paused') return 'question-paused';
  if (node.excludedReason === 'active-or-recently-active') return 'active';
  return node.outcome || 'unknown';
}

function displayTree(plan, mode, depth) {
  const { root, countDescendants, allSucceeded } = plan;
  const concerned = new Set([...plan.restartLeaves, ...plan.ancestors]);
  const lines = [];
  const prefixFor = (prefix, last) => `${prefix}${last ? '└─ ' : '├─ '}`;
  const nodeLine = (node, depthSuffix = '') => {
    const stateMarkers = markers(node, plan).join(' ');
    const suffix = stateMarkers ? ` ${stateMarkers}` : '';
    return `${node.title} (${node.id}) — ${outcomeLabel(node)}${suffix}${depthSuffix}`;
  };

  function writePlaceholder(prefix, last, count, type = 'succeeded children') {
    if (count > 0) lines.push(`${prefixFor(prefix, last)}… ${count} ${type} (collapsed)`);
  }

  function renderRestart(node, level, prefix, last, includeRoot = false) {
    if (!includeRoot && !concerned.has(node.id)) return;
    let deeperSuffix = '';
    const descendantsOnPath = countConcernedDescendants(node, concerned);
    if (Number.isFinite(depth) && level >= depth && descendantsOnPath > 0) deeperSuffix = ` (+${descendantsOnPath} deeper)`;
    lines.push(`${includeRoot ? '' : prefixFor(prefix, last)}${nodeLine(node, deeperSuffix)}`);

    const concernedChildren = node.children.filter((child) => concerned.has(child.id));
    const succeededCollapsed = node.children.filter((child) => child.outcome === 'succeeded' && !concerned.has(child.id)).length;
    const mayDescend = !Number.isFinite(depth) || level < depth;
    if (mayDescend) {
      const siblings = [...concernedChildren];
      const needPlaceholder = succeededCollapsed > 0;
      const childTotal = siblings.length + (needPlaceholder ? 1 : 0);
      let emitted = 0;
      for (const child of siblings) {
        emitted += 1;
        renderRestart(child, level + 1, `${prefix}${includeRoot ? '' : last ? '   ' : '│  '}`, emitted === childTotal);
      }
      if (needPlaceholder) writePlaceholder(`${prefix}${includeRoot ? '' : last ? '   ' : '│  '}`, true, succeededCollapsed);
    } else if (succeededCollapsed > 0) {
      writePlaceholder(`${prefix}${includeRoot ? '' : last ? '   ' : '│  '}`, true, succeededCollapsed);
    }
  }

  function countConcernedDescendants(node, set) {
    let count = 0;
    for (const child of node.children) {
      if (set.has(child.id)) count += 1 + countConcernedDescendants(child, set);
    }
    return count;
  }

  function renderFull(node, level, prefix, last, includeRoot = false) {
    let suffix = '';
    if (Number.isFinite(depth) && level >= depth && allSucceeded(node) && countDescendants(node) > 0) {
      suffix = ` (+${countDescendants(node)} deeper)`;
    }
    lines.push(`${includeRoot ? '' : prefixFor(prefix, last)}${nodeLine(node, suffix)}`);

    const mayExpand = !allSucceeded(node) || !Number.isFinite(depth) || level < depth;
    if (!mayExpand) return;
    const children = node.children;
    if (!children.length) return;

    const expandChildren = [];
    let collapsedSucceeded = 0;
    for (const child of children) {
      if (Number.isFinite(depth) && level >= depth && allSucceeded(child)) collapsedSucceeded += 1;
      else expandChildren.push(child);
    }
    const withPlaceholder = collapsedSucceeded > 0;
    const total = expandChildren.length + (withPlaceholder ? 1 : 0);
    let emitted = 0;
    for (const child of expandChildren) {
      emitted += 1;
      renderFull(child, level + 1, `${prefix}${includeRoot ? '' : last ? '   ' : '│  '}`, emitted === total);
    }
    if (withPlaceholder) writePlaceholder(`${prefix}${includeRoot ? '' : last ? '   ' : '│  '}`, true, collapsedSucceeded);
  }

  if (mode === 'full') {
    renderFull(root, 0, '', true, true);
  } else if (plan.restartLeaves.size === 0) {
    lines.push('No restart targets.');
    const succeededChildren = root.children.filter((child) => child.outcome === 'succeeded').length;
    lines.push(nodeLine(root));
    writePlaceholder('', true, succeededChildren);
  } else {
    renderRestart(root, 0, '', true, true);
  }
  return lines.join('\n');
}

function buildJsonTree(plan, mode, depth) {
  const concerned = new Set([...plan.restartLeaves, ...plan.ancestors]);
  const { root, countDescendants, allSucceeded } = plan;

  function toJson(node, level) {
    const result = {
      id: node.id,
      title: node.title,
      url: node.url,
      outcome: outcomeLabel(node),
      marks: markers(node, plan),
    };
    if (isFailure(node)) result.errorClass = node.errorClass;
    const candidateChildren = mode === 'full'
      ? node.children
      : node.children.filter((child) => concerned.has(child.id));
    if (mode !== 'full' && plan.restartLeaves.size === 0 && node.id === root.id) {
      result.children = [];
      result.collapsedSucceededChildren = node.children.filter((child) => child.outcome === 'succeeded').length;
      return result;
    }
    const atLimit = Number.isFinite(depth) && level >= depth;
    const children = [];
    let collapsedSucceededChildren = 0;
    for (const child of candidateChildren) {
      if (mode === 'full' && atLimit && allSucceeded(child)) collapsedSucceededChildren += 1;
      else if (mode === 'restart' && atLimit) continue;
      else children.push(toJson(child, level + 1));
    }
    result.children = children;
    if (collapsedSucceededChildren > 0) result.collapsedSucceededChildren = collapsedSucceededChildren;
    const hiddenConcerned = mode !== 'full' && atLimit
      ? countConcernedDescendants(node, concerned)
      : mode === 'full' && atLimit && allSucceeded(node) ? countDescendants(node) : 0;
    if (hiddenConcerned > 0) result.deeper = hiddenConcerned;
    if (mode === 'full' && atLimit && allSucceeded(node) && countDescendants(node) > 0) result.deeper = countDescendants(node);
    return result;
  }

  function countConcernedDescendants(node, set) {
    let count = 0;
    for (const child of node.children) if (set.has(child.id)) count += 1 + countConcernedDescendants(child, set);
    return count;
  }

  return toJson(root, 0);
}

function createResult(plan, options, generatedAt) {
  const analyzedMode = options.mode === 'full' ? 'full' : 'restart';
  const excluded = [...plan.root.children.flatMap((child) => flatten(child)), plan.root]
    .filter((node) => node.excludedReason)
    .map((node) => ({ id: node.id, reason: node.excludedReason }));
  const restartLeaves = [...plan.restartLeaves].map((id) => {
    const node = findNode(plan.root, id);
    return { id: node.id, title: node.title, url: node.url, errorClass: node.errorClass };
  });
  const ancestors = [...plan.ancestors].map((id) => {
    const node = findNode(plan.root, id);
    return { id: node.id, title: node.title, url: node.url };
  });
  const superseded = [...plan.superseded].map((id) => {
    const node = findNode(plan.root, id);
    return { id: node.id, title: node.title, reason: node.supersededReason || 'superseded by a later successful sibling' };
  });
  return {
    root: { id: plan.root.id, title: plan.root.title, url: plan.root.url },
    generatedAt,
    mode: options.mode,
    depth: Number.isFinite(options.depth) ? options.depth : null,
    counts: plan.counts,
    restartLeaves,
    ancestors,
    superseded,
    excluded,
    tree: buildJsonTree(plan, analyzedMode, options.depth),
    suggestedRecoverInput: {
      rootId: plan.root.id,
      // tree.recover already treats succeeded nodes as complete and leaves active
      // nodes pending; only old failed/interrupted attempts need explicit exclusion.
      excludeSessionIds: [...plan.superseded].sort(),
      pinModel: options.pinModel,
    },
  };
}

function flatten(node) {
  return [node, ...node.children.flatMap(flatten)];
}

function findNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = queryDatabase(options.db, options.root);
  const nodes = normalizeRows(rows, Date.now());
  const plan = computePlan(nodes, options.root);
  const generatedAt = new Date().toISOString();
  const mode = options.mode === 'full' ? 'full' : 'restart';
  if (options.mode === 'json') {
    const result = createResult(plan, options, generatedAt);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const tree = displayTree(plan, mode, options.depth);
  const counts = plan.counts;
  process.stdout.write(`${tree}\n\nTotals — nodes scanned: ${counts.nodesScanned}; failed: ${counts.failed}; superseded: ${counts.superseded}; restart leaves: ${counts.restartLeaves}; ancestors: ${counts.ancestors}; succeeded: ${counts.succeeded}; question-paused: ${counts.questionPaused}\n`);
}

try {
  main();
} catch (error) {
  console.error(`tree-view: ${error?.message || String(error)}`);
  process.exitCode = 1;
}
