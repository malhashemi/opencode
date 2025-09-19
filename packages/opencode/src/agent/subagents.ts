import { Agent } from "./agent"
import { Config } from "../config/config"

// Simple wildcard match: '*' matches any sequence. We keep it minimal, no extglob.
function match(pattern: string, value: string) {
  if (pattern === "*") return true
  // Escape regex special chars except * then replace * with .*
  const regex = new RegExp("^" + pattern.split(/([*])/).map((p) => (p === "*" ? ".*" : p.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&"))).join("") + "$")
  return regex.test(value)
}

// Determine precedence: longer non-wildcard prefix length first, then last index (later override) if tie.
function specificity(pattern: string) {
  const firstWildcard = pattern.indexOf("*")
  return firstWildcard === -1 ? pattern.length : firstWildcard
}

interface Resolved { pattern: string; value: boolean; index: number }

function resolvePattern(map: Record<string, boolean> | undefined, name: string): Resolved | undefined {
  if (!map) return
  const entries = Object.entries(map)
  const matched: Resolved[] = []
  entries.forEach(([pat, val], idx) => {
    if (match(pat, name)) matched.push({ pattern: pat, value: val, index: idx })
  })
  if (!matched.length) return
  matched.sort((a, b) => {
    const sa = specificity(a.pattern)
    const sb = specificity(b.pattern)
    if (sa !== sb) return sb - sa // longer first
    return b.index - a.index // later first
  })
  return matched[0]
}

export async function accessibleSubagents(forAgent: string) {
  const cfg = await Config.get()
  const agents = await Agent.list()
  const caller = await Agent.get(forAgent)
  if (!caller) return []

  // gather candidate subagents (mode=subagent or all) excluding self unless its mode allows
  const candidates = agents.filter((a) => a.name !== caller.name && (a.mode === "subagent" || a.mode === "all"))

  const globalMap = (cfg as any).subagents as Record<string, boolean> | undefined
  const perAgentMap = (cfg.agent?.[caller.name] as any)?.subagents as Record<string, boolean> | undefined

  // Determine if global default deny is active ("*": false exact)
  const globalDefaultDeny = globalMap?.["*"] === false

  return candidates.filter((cand) => {
    // Start with default (true unless global default deny)
    let allowed = !globalDefaultDeny
    const g = resolvePattern(globalMap, cand.name)
    if (g) allowed = g.value
    const p = resolvePattern(perAgentMap, cand.name)
    if (p) allowed = p.value
    return allowed
  })
}

export function isSubagentEnabled(_forAgent: string, subagentName: string, context: { global?: Record<string, boolean>; perAgent?: Record<string, boolean> }) {
  const globalMap = context.global
  const perAgentMap = context.perAgent
  const globalDefaultDeny = globalMap?.["*"] === false
  let allowed = !globalDefaultDeny
  const g = resolvePattern(globalMap, subagentName)
  if (g) allowed = g.value
  const p = resolvePattern(perAgentMap, subagentName)
  if (p) allowed = p.value
  return allowed
}

export const _internal = { match, resolvePattern }
