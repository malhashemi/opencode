import { describe, expect, test, beforeAll } from "bun:test"
import { accessibleSubagents, _internal } from "../../src/agent/subagents"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
import { Agent } from "../../src/agent/agent"
import { mergeDeep } from "remeda"

// Utility to provide a synthetic config for tests
async function withConfig<T>(cfg: any, fn: () => Promise<T>) {
  return await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      // Monkey patch Config.get within this Instance scope
      const original = Config.get
      ;(Config as any).get = async () => cfg
      try {
        // Force Agent state to rebuild each time by accessing private state indirectly
        return await fn()
      } finally {
        ;(Config as any).get = original
      }
    },
  })
}

describe("subagents access", () => {
  const base = {
    agent: {
      build: {},
      general: { mode: "subagent" },
      helper: { mode: "subagent" },
      "doc-reader": { mode: "subagent" },
      "doc-extractor": { mode: "subagent" },
      "git-committer": { mode: "subagent" },
    },
  }

  test("default all allowed when no maps", async () => {
    const names = await withConfig(base, async () => (await accessibleSubagents("build")).map((a) => a.name).sort())
    expect(names).toEqual(["doc-extractor", "doc-reader", "general", "git-committer", "helper"]) // all except build itself
  })

  test("global disable all then enable single per agent", async () => {
    const cfg = {
      ...base,
      subagents: { "*": false },
      agent: { ...base.agent, build: { subagents: { general: true } } },
    }
    const names = await withConfig(cfg, async () => (await accessibleSubagents("build")).map((a) => a.name))
    expect(names).toEqual(["general"]) // helper remains disabled
  })

  test("wildcard group enable", async () => {
    const cfg = {
      ...base,
      subagents: { "*": false },
      agent: { ...base.agent, build: { subagents: { "doc-*": true } } },
    }
    const names = await withConfig(cfg, async () => (await accessibleSubagents("build")).map((a) => a.name).sort())
    expect(names).toEqual(["doc-extractor", "doc-reader"]) // only doc-*
  })

  test("specific override after broad enable", async () => {
    const cfg = {
      ...base,
      subagents: { "*": false },
      agent: { ...base.agent, build: { subagents: { "*": true, "git-committer": false } } },
    }
    const names = await withConfig(cfg, async () => (await accessibleSubagents("build")).map((a) => a.name).sort())
    expect(names).toEqual(["doc-extractor", "doc-reader", "general", "helper"]) // git-committer excluded
  })
})

describe("pattern resolver specificity", () => {
  test("longer literal prefix wins", () => {
    const { resolvePattern } = _internal as any
    const map = { "git-*": true, "git-commit*": false }
    const r = resolvePattern(map, "git-committer")
    expect(r.value).toBe(false)
  })
})
