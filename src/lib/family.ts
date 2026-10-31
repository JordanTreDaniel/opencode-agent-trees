// Pure family-tree logic over the OpenCode session graph.
//
// OpenCode exposes no `parent()` / `children()` helper: the only primitives are
// `Session.Info.parentID` and `ctx.session.list({ parentID })`. Everything here
// is built on those two facts.

export interface SessionLike {
  id: string
  parentID?: string | undefined
  title?: string | undefined
  agent?: string | undefined
  model?: { providerID: string; id: string } | undefined
  outcome?: "succeeded" | "failed" | "interrupted" | undefined
  time?: { created?: number | undefined; updated?: number | undefined } | undefined
}

export interface FamilyDeps {
  get(id: string): Promise<SessionLike | undefined>
  listChildren(parentID: string): Promise<readonly SessionLike[]>
}

export interface SelfDescription {
  sessionID: string
  agent?: string | undefined
  title?: string | undefined
  parentID?: string | undefined
  rootID: string
  depth: number
}

export interface FamilyNode {
  sessionID: string
  agent?: string | undefined
  title?: string | undefined
  outcome?: string | undefined
  model?: string | undefined
  children: FamilyNode[]
  truncated?: boolean
}

export interface FamilyTree {
  rootID: string
  focusID: string
  depth: number
  nodeCount: number
  truncated: boolean
  cycleDetected: boolean
  tree: FamilyNode
}

export function modelLabel(session: SessionLike): string | undefined {
  return session.model ? `${session.model.providerID}/${session.model.id}` : undefined
}

const MAX_UP = 64

/** Walks `parentID` upward. `get` is synchronous because callers pre-load the chain. */
export function describeSelf(
  sessionID: string,
  get: (id: string) => SessionLike | undefined,
): SelfDescription {
  const self = get(sessionID)
  const seen = new Set<string>([sessionID])
  let cursor = self
  let depth = 0
  let rootID = sessionID
  while (cursor?.parentID) {
    if (seen.has(cursor.parentID) || depth >= MAX_UP) break
    seen.add(cursor.parentID)
    const parent = get(cursor.parentID)
    if (!parent) {
      rootID = cursor.parentID
      depth += 1
      break
    }
    cursor = parent
    rootID = parent.id
    depth += 1
  }
  return {
    sessionID,
    agent: self?.agent,
    title: self?.title,
    parentID: self?.parentID,
    rootID,
    depth,
  }
}

export async function loadAncestors(
  sessionID: string,
  deps: Pick<FamilyDeps, "get">,
): Promise<Map<string, SessionLike>> {
  const cache = new Map<string, SessionLike>()
  const seen = new Set<string>()
  let cursor: string | undefined = sessionID
  while (cursor && !seen.has(cursor) && cache.size < MAX_UP) {
    seen.add(cursor)
    const session = await deps.get(cursor)
    if (!session) break
    cache.set(session.id, session)
    cursor = session.parentID
  }
  return cache
}

function compare(a: SessionLike, b: SessionLike): number {
  const at = a.time?.created ?? 0
  const bt = b.time?.created ?? 0
  if (at !== bt) return at - bt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface BuildFamilyInput {
  sessionID: string
  includeSelf?: boolean | undefined
  maxNodes?: number | undefined
}

export async function buildFamily(input: BuildFamilyInput, deps: FamilyDeps): Promise<FamilyTree> {
  const includeSelf = input.includeSelf !== false
  const maxNodes = Math.max(1, input.maxNodes ?? 200)

  const focus = await deps.get(input.sessionID)
  if (!focus) throw new Error(`session not found: ${input.sessionID}`)

  // 1. Walk UP to the root, remembering the chain so we can compute depth.
  const chain: SessionLike[] = [focus]
  const seen = new Set<string>([focus.id])
  let cycleDetected = false
  let cursor = focus
  while (cursor.parentID) {
    if (seen.has(cursor.parentID)) {
      cycleDetected = true
      break
    }
    const parent = await deps.get(cursor.parentID)
    if (!parent) break
    seen.add(parent.id)
    chain.push(parent)
    cursor = parent
  }
  const root = chain[chain.length - 1]!
  const depth = chain.length - 1

  // 2. Walk DOWN from the root (or from the focus when includeSelf is false),
  //    listing children per node. Siblings come for free because every node's
  //    children are enumerated, which is what makes "cousins" answerable.
  const start = includeSelf ? root : focus
  let nodeCount = 0
  let truncated = false
  const downSeen = new Set<string>()

  const build = async (session: SessionLike): Promise<FamilyNode> => {
    if (downSeen.has(session.id)) {
      cycleDetected = true
      return {
        sessionID: session.id,
        agent: session.agent,
        title: session.title,
        outcome: session.outcome,
        model: modelLabel(session),
        children: [],
      }
    }
    downSeen.add(session.id)
    nodeCount += 1
    const node: FamilyNode = {
      sessionID: session.id,
      agent: session.agent,
      title: session.title,
      outcome: session.outcome,
      model: modelLabel(session),
      children: [],
    }
    const kids = [...(await deps.listChildren(session.id))].sort(compare)
    for (const kid of kids) {
      if (nodeCount >= maxNodes) {
        truncated = true
        node.truncated = true
        break
      }
      node.children.push(await build(kid))
    }
    return node
  }

  const tree = await build(start)
  return {
    rootID: root.id,
    focusID: focus.id,
    depth,
    nodeCount,
    truncated,
    cycleDetected,
    tree,
  }
}
